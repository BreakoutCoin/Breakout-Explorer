// Direct JSON-RPC client for breakoutd.
//
// Everything in the explorer used to reach the daemon the long way round:
// lib/explorer.js built a URL against the explorer's OWN web listener
// (http://127.0.0.1:3001/api/...), which bitcoin-node-api then forwarded to
// the wallet. That had three costs.
//
//   1. The web cluster had to be running for the INDEXER to work. A reindex
//      issues millions of calls, every one of them a loopback HTTP request
//      into the same four workers that serve the public site.
//   2. bitcoin-node-api forwards query parameters POSITIONALLY, in whatever
//      order they appear in the URL, discarding their names. Nothing checks
//      that ?txid=..&decrypt=1 was not written the other way round. The
//      explorer's own API page documents getblockhash?index= while
//      lib/explorer.js calls getblockhash?height= -- both "work", which is
//      precisely the problem.
//   3. Values were coerced with parseFloat, so a boolean argument could not
//      be expressed at all: ordering=false arrived as the string "false" and
//      ordering=0 as the number 0, and the daemon rejected both.
//
// This module talks to the wallet directly and takes NAMED arguments, with a
// signature table (METHODS below) as the single place that knows a method's
// parameter order and types. Callers cannot transpose arguments, and real
// booleans and integers reach the daemon.
//
// The daemon speaks JSON-RPC 1.0, whose params are a positional array -- there
// is no named-parameter form to reach. Ordering is therefore not something
// that can be removed, only confined to this table.
//
// NOTE: this does NOT replace the public /api/* passthrough, which still runs
// on bitcoin-node-api and is unchanged. This is the internal path only.

var http = require('http')
  , settings = require('./settings');

// bitcoin-node-api answered any RPC failure with this exact string, and
// callers in app.js, lib/database.js, lib/explorer.js and routes/index.js
// compare against it verbatim. It is part of the contract until those are
// migrated, so failures here reproduce it rather than throwing.
var ERRSTR = 'There was an error. Check your console.';

// Parameter spec: {names: [...accepted names...], type: 'int'|'float'|'string'|'bool'}
// Order within each array IS the positional order sent to the daemon.
// Aliases exist where the codebase and the API docs already disagree.
var METHODS = {
  // --- core / chain -------------------------------------------------------
  getinfo:                [],
  getmininginfo:          [],
  getnetworkhashps:       [],
  getdifficulty:          [],
  getconnectioncount:     [],
  getpeerinfo:            [],
  getblockcount:          [],
  gettxoutsetinfo:        [],
  getbestblock:           [{names: ['txinfo'], type: 'bool'}],
  getblockbynumber:       [{names: ['number', 'height'], type: 'int'},
                           {names: ['txinfo'], type: 'bool'}],
  getblockhash:           [{names: ['height', 'index'], type: 'int'}],
  getblock:               [{names: ['hash'], type: 'string'}],
  getrawtransaction:      [{names: ['txid', 'hash'], type: 'string'},
                           {names: ['decrypt', 'verbose'], type: 'int'}],

  // --- Breakout reward / supply ------------------------------------------
  getmaxmoney:            [],
  getmaxvote:             [],
  getvote:                [],
  getphase:               [],
  getreward:              [],
  getnextrewardestimate:  [],
  getnextrewardwhenstr:   [],
  getsupply:              [],

  // --- Explore API (requires exploreapi=1 on the daemon) ------------------
  getaddressinfo:         [{names: ['address'], type: 'string'}],
  getaddressbalance:      [{names: ['address'], type: 'string'}],
  getaddresstxspg:        [{names: ['address'], type: 'string'},
                           {names: ['page'], type: 'int'},
                           {names: ['perpage'], type: 'int'},
                           {names: ['ordering'], type: 'bool'}],
  getaddressinoutspg:     [{names: ['address'], type: 'string'},
                           {names: ['page'], type: 'int'},
                           {names: ['perpage'], type: 'int'},
                           {names: ['ordering'], type: 'bool'}],
  getaddressutxospg:      [{names: ['address'], type: 'string'},
                           {names: ['page'], type: 'int'},
                           {names: ['perpage'], type: 'int'},
                           {names: ['ordering'], type: 'bool'}],
  getrichlist:            [{names: ['color'], type: 'int'},
                           {names: ['start'], type: 'int'},
                           {names: ['max'], type: 'int'}],
  getrichlistpg:          [{names: ['color'], type: 'int'},
                           {names: ['page'], type: 'int'},
                           {names: ['perpage'], type: 'int'},
                           {names: ['ordering'], type: 'bool'}],
  getrichlistsize:        [{names: ['color'], type: 'int'},
                           {names: ['minbalance'], type: 'float'}],
  getcardinfo:            [{names: ['ticker'], type: 'string'}]
};

// Coerce a supplied value to the type the daemon expects. Returns undefined
// when the value cannot be represented, which the caller treats as an error
// rather than silently sending something the daemon will misread.
function coerce(value, type) {
  switch (type) {
    case 'int':
      var i = parseInt(value, 10);
      return isNaN(i) ? undefined : i;
    case 'float':
      var f = parseFloat(value);
      return isNaN(f) ? undefined : f;
    case 'bool':
      if (typeof value === 'boolean') return value;
      var s = String(value).toLowerCase();
      if (s === 'true' || s === '1' || s === 'yes') return true;
      if (s === 'false' || s === '0' || s === 'no') return false;
      return undefined;
    case 'string':
      return String(value);
    default:
      return undefined;
  }
}

// Turn {address: 'bx..', page: 1} into the positional array the daemon wants,
// using the first name in each spec that the caller actually supplied.
//
// Trailing optional parameters may be omitted, but a GAP cannot be: JSON-RPC
// is positional, so supplying the third argument without the second would
// silently shift it into the wrong slot. That is refused.
function build_params(method, args) {
  var specs = METHODS[method];
  var params = [];
  var lastSupplied = -1;

  for (var i = 0; i < specs.length; i++) {
    // `found` must be cleared each time round: `var` is function-scoped, so
    // leaving it set would make a missing argument silently inherit the
    // previous one's value -- exactly the mix-up this table exists to prevent.
    var spec = specs[i], found = undefined;
    for (var n = 0; n < spec.names.length; n++) {
      if (args && Object.prototype.hasOwnProperty.call(args, spec.names[n])) {
        found = args[spec.names[n]];
        break;
      }
    }
    if (found === undefined || found === null || found === '') {
      params.push(undefined);
      continue;
    }
    var value = coerce(found, spec.type);
    if (value === undefined) {
      return {error: 'parameter "' + spec.names[0] + '" of ' + method +
                     ' is not a valid ' + spec.type + ': ' + found};
    }
    params.push(value);
    lastSupplied = i;
  }

  params = params.slice(0, lastSupplied + 1);
  for (var j = 0; j < params.length; j++) {
    if (params[j] === undefined) {
      return {error: method + ' is missing "' + specs[j].names[0] +
                     '", which is required because a later argument was given'};
    }
  }
  return {params: params};
}

var id_counter = 0;

// A reindex makes millions of calls. Without keep-alive each one costs a fresh
// TCP connection and a trip through the daemon's RPC accept path, which comes
// to dominate the run.
var agent = new http.Agent({keepAlive: true, maxSockets: 8});

// call(method, args, cb) -> cb(result)
//
// Single-callback style, matching the request()-based code this replaces:
// on any failure the callback receives ERRSTR rather than an error object.
function call(method, args, cb) {
  if (typeof args === 'function') { cb = args; args = {}; }

  if (!Object.prototype.hasOwnProperty.call(METHODS, method)) {
    console.log('rpc: refusing unknown method "%s"', method);
    return cb(ERRSTR);
  }

  var built = build_params(method, args);
  if (built.error) {
    console.log('rpc: %s', built.error);
    return cb(ERRSTR);
  }

  var payload = JSON.stringify({
    jsonrpc: '1.0',
    id: 'explorer-' + (++id_counter),
    method: method,
    params: built.params
  });

  var req = http.request({
    host: process.env.EXPLORER_RPC_HOST || settings.wallet.host,
    port: settings.wallet.port,
    method: 'POST',
    path: '/',
    agent: agent,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      'Authorization': 'Basic ' + Buffer.from(
          settings.wallet.user + ':' + settings.wallet.pass).toString('base64')
    }
  }, function(res) {
    var body = '';
    res.setEncoding('utf8');
    res.on('data', function(chunk) { body += chunk; });
    res.on('end', function() {
      var parsed;
      try {
        parsed = JSON.parse(body);
      } catch (e) {
        // A 401 answers in HTML, not JSON, so say so plainly rather than
        // reporting a parse failure.
        console.log('rpc: %s returned unparseable response (HTTP %s): %s',
                    method, res.statusCode, body.slice(0, 200));
        return cb(ERRSTR);
      }
      if (parsed.error) {
        console.log('rpc: %s failed: %s', method,
                    parsed.error.message || JSON.stringify(parsed.error));
        return cb(ERRSTR);
      }
      return cb(parsed.result);
    });
  });

  req.on('error', function(e) {
    console.log('rpc: %s could not reach the wallet at %s:%s (%s)', method,
                settings.wallet.host, settings.wallet.port, e.message);
    return cb(ERRSTR);
  });

  req.setTimeout(60000, function() {
    console.log('rpc: %s timed out', method);
    req.destroy();
  });

  req.write(payload);
  req.end();
}

module.exports = {
  ERRSTR: ERRSTR,
  METHODS: METHODS,
  call: call,
  // exposed for the /api/ rewrite that will share this table
  build_params: build_params
};

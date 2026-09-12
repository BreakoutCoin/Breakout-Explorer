// Server routes.
//
// The explorer used to ship two complete front ends: this one, rendering Jade
// templates server-side, and public/thedeck.html, a single-page app served as
// the static index. Both were live at once -- the site root gave you the Deck,
// while /richlist, /movement, /tx/<hash> and the rest still gave you the old
// Iquidus pages, which anyone arriving from an old link or an external
// reference would land on.
//
// Two implementations of the same pages is a standing invitation for one of
// them to go quietly wrong, and the Jade set was the weaker of the two: fewer
// currencies, no Deck, and the last remaining reason to keep the transaction
// index alive, since its movement view read /ext/getlasttxs.
//
// It is retired. What remains is the redirects that keep old links working,
// and the handful of endpoints that were always API rather than UI.

var express = require('express')
  , router = express.Router()
  , settings = require('../lib/settings')
  , lib = require('../lib/explorer')
  , rpc = require('../lib/rpc')
  , qr = require('qr-image');

// ---------------------------------------------------------------------------
// Redirects into the single-page UI.
//
// Its routing is hash-based, so these land on /#/<route>; a bare path would
// come straight back here.
// ---------------------------------------------------------------------------
function deck(res, hashRoute) {
  res.redirect(302, '/#/' + hashRoute);
}

router.get('/info',     function(req, res) { deck(res, 'api'); });
router.get('/richlist', function(req, res) { deck(res, 'richlist'); });
router.get('/movement', function(req, res) { deck(res, 'movement'); });
router.get('/network',  function(req, res) { deck(res, 'network'); });

// No equivalent page; send them somewhere real rather than nowhere.
router.get('/reward',          function(req, res) { deck(res, ''); });
router.get('/markets/:market', function(req, res) { deck(res, ''); });

router.get('/tx/:txid', function(req, res) {
  deck(res, 'tx/' + encodeURIComponent(req.params.txid));
});

router.get('/address/:hash', function(req, res) {
  deck(res, 'address/' + encodeURIComponent(req.params.hash));
});
router.get('/address/:hash/:count', function(req, res) {
  deck(res, 'address/' + encodeURIComponent(req.params.hash));
});

// The old page took a block HASH; the Deck UI's block route takes a HEIGHT.
// Resolve it rather than handing the UI something it cannot use.
router.get('/block/:hash', function(req, res) {
  var hash = req.params.hash;
  if (/^[0-9]+$/.test(hash)) {
    return deck(res, 'block/' + hash);      // already a height
  }
  lib.get_block(hash, function(block) {
    if (block && typeof block === 'object' && block.height != null) {
      return deck(res, 'block/' + block.height);
    }
    deck(res, 'blocks');
  });
});

// The old search form posted here.
router.post('/search', function(req, res) {
  var query = ((req.body && req.body.search) || '').trim();
  deck(res, query ? ('search/' + encodeURIComponent(query)) : '');
});

// ---------------------------------------------------------------------------
// Endpoints that were always API
// ---------------------------------------------------------------------------

router.get('/qr/:string', function(req, res) {
  if (!req.params.string) return res.status(400).send('');
  var image = qr.image(req.params.string, { type: 'png', size: 4, margin: 1 });
  res.type('png');
  image.pipe(res);
});

// Chain-wide summary for the front page.
//
// supply and the address count both come from the daemon: the former from the
// block index, the latter by summing getrichlistsize across the currencies.
// Breakout addresses carry their currency in the prefix, so an address belongs
// to exactly one colour and the sum counts each address once.
router.get('/ext/summary', function(req, res) {
  lib.get_difficulty(function(difficulty) {
    var difficultyHybrid = '';
    if (difficulty && difficulty['proof-of-work']) {
      if (settings.index.difficulty == 'Hybrid') {
        difficultyHybrid = 'POS: ' + difficulty['proof-of-stake'];
        difficulty = 'POW: ' + difficulty['proof-of-work'];
      } else if (settings.index.difficulty == 'POW') {
        difficulty = difficulty['proof-of-work'];
      } else {
        difficulty = difficulty['proof-of-stake'];
      }
    }
    lib.get_hashrate(function(hashrate) {
      lib.get_connectioncount(function(connections) {
        lib.get_blockcount(function(blockcount) {
          lib.get_moneysupply(settings.symbol, function(supply) {
            lib.get_address_count(function(addresses) {
              if (hashrate == rpc.ERRSTR) hashrate = 0;
              res.send({ data: [{
                difficulty: difficulty,
                difficultyHybrid: difficultyHybrid,
                supply: supply || 0,
                addresses: addresses || 0,
                hashrate: hashrate,
                lastPrice: 0,
                connections: connections,
                blockcount: blockcount
              }]});
            });
          });
        });
      });
    });
  });
});

module.exports = router;

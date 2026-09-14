Breakout Explorer
=================

The block explorer for [Breakout Chain](https://breakoutcoin.com/): blocks,
transactions, addresses, rich lists and large transfers for its three
currencies (BRK, BRX and SIS), and The Deck, a set of 53 playing-card NFTs.

It runs at **https://explorer.breakoutchain.com**.

Breakout Explorer began as a fork of
[Iquidus Explorer](https://github.com/iquidus/explorer) 1.6.1, and still has
its directory layout, but has since moved well away from it. It keeps no
database. Every figure on every page comes from a Breakout node at the moment
the page is requested, so the explorer can never lag or disagree with the chain.

### Related services

* [explore.brk.zone](https://explore.brk.zone) and
  [api.brk.zone](https://api.brk.zone) run
  [Breakout-Explore-CORS](https://github.com/BreakoutCoin/Breakout-Explore-CORS),
  a public, browser-friendly proxy over the same Breakout Explore API. The
  first is the primary host and the second a live backup. Each follows the chain
  with its own node, independently of this explorer, which makes them useful
  for cross-checking it.
* [Breakout-Chain-Client](https://github.com/BreakoutCoin/Breakout-Chain-Client)
  is the node, `breakoutd`, that this explorer reads from.

Requirements
------------

* **`breakoutd` with the Explore API enabled.** Put `exploreapi=1` in
  `breakout.conf` and let the node build its explore index. Without it the
  node still answers core RPC, so blocks and transactions work, but addresses,
  rich lists, movement and The Deck come back empty. The node must be recent
  enough to provide `getbestblock`, `getcardinfo` and `getmovementspg`.
* **Node.js older than 12.** The explorer uses Express 4.2, which reads a
  response property that Node 12 removed. On a newer Node the page still loads,
  but every JSON endpoint crashes its worker.
* **npm 7 or newer**, to install from the version 3 `package-lock.json`.

No database is needed.

Install
-------

    git clone https://github.com/BreakoutCoin/Breakout-Explorer.git
    cd Breakout-Explorer
    npm ci --omit=dev

Use `npm ci`, not `npm install`. `npm ci` rebuilds `node_modules` exactly from
the lock file. `npm install` can leave packages from an older checkout in place.

Configure
---------

    cp settings.json.template settings.json

`settings.json` is ignored by git, so your credentials stay out of the
repository. The template is inherited from Iquidus; for Breakout, set at least:

| Setting | Value |
|---|---|
| `coin`, `symbol` | `"Breakout"`, `"BRK"` |
| `wallet` | the node's RPC endpoint: `host`, `port` (50542 by default), and the `rpcuser` / `rpcpassword` from `breakout.conf` |
| `index.difficulty` | `"Hybrid"`: Breakout has both proof-of-work and proof-of-stake blocks |
| `genesis_block`, `genesis_tx` | from `breakoutd getblockhash 0` and that block's first transaction |
| `port` | the port the explorer listens on (3001 by default) |

Settings are read only at startup.

Run
---

    npm start      # starts a master process and one worker per CPU
    npm stop

Check that the explorer is healthy:

    curl -s localhost:3001/ext/summary

A non-zero `addresses` means the Explore API is answering. A current
`blockcount` means core RPC is.

In production, run the explorer behind a reverse proxy that handles TLS, and
under a service manager such as systemd. Stop it with `SIGINT`, because the
cluster master shuts its workers down only on that signal.

Using the explorer
------------------

The site is a single page, `public/thedeck.html`, with hash routes:

    /#/block/{height}
    /#/tx/{txid}
    /#/address/{address}
    /#/card/{ticker}
    /#/richlist/{BRK|BRX|SIS}
    /#/movement
    /#/network

Links in the old Iquidus form (`/tx/…`, `/address/…`, `/block/{hash}`, and so
on) redirect to the corresponding page.

API
---

Everything below is read-only JSON, and `/ext/*` allows cross-origin requests.

**`/ext/*`**: endpoints built for the explorer, answered from the node:

| Endpoint | Returns |
|---|---|
| `/ext/summary` | chain-wide summary: height, difficulty, supply, unique addresses, connections |
| `/ext/getaddress/{address}` | balance, sent, received, currency and recent transactions |
| `/ext/getbalance/{address}` | balance only |
| `/ext/gettx/{txid}` | a transaction with currency-tagged inputs and outputs, and its fee |
| `/ext/getblock/{height}` | a block with its transactions |
| `/ext/getlastblocks/{count}`, `/ext/getblockpage/{page}` | recent blocks |
| `/ext/getcoinstats/{coin}`, `/ext/getsupply/{coin}` | holder count and supply for a currency |
| `/ext/getrichlistpg/{coin}/{page}?per={n}` | paged rich list, with ranks and share of supply |
| `/ext/getcoindist/{coin}`, `/ext/getcoinbuckets/{coin}` | distribution by holder tier and by balance |
| `/ext/getmovement/{all\|BRK\|BRX\|SIS}/{page}` | large transfers |
| `/ext/getdeck`, `/ext/getcard/{ticker}`, `/ext/getcardtxs/{count}` | The Deck: holders, custody history and recent card transfers |
| `/ext/connections` | the node's current peers |

**`/api/{method}`**: a pass-through to a fixed list of read-only node RPC
methods (for example `getblockcount`, `getblock`, `getrawtransaction`,
`getaddressinfo` and `getrichlist`). Anything not on that list is refused. The
list is in `app.js`. Query parameters are passed to the node **by position**,
in the order they appear in the URL, so `getrichlist` needs
`?color=57&start=1&max=100` in exactly that order.

A currency's colour is its index in the Breakout protocol: BRX is 1, BRK 2,
SIS 57, and the Deck cards 4–56. See `lib/currencies.js`.

Credits and licences
--------------------

* Breakout Explorer is a fork of Iquidus Explorer, © 2015 Iquidus Technology
  and Luke Williams, and keeps its BSD 3-clause licence: see `LICENSE`.
* The playing-card faces are from Byron Knoll's Vector Playing Cards, which he
  released into the public domain: see `public/images/cards/SOURCE`.
* The fonts are JetBrains Mono, Silkscreen and VT323, all under the SIL Open
  Font License 1.1: see `public/fonts/`.
* Address icons are drawn with
  [Stealthicons](https://stealthicons.stealth.org/): see
  `public/vendor/stealthicons/`.
* jqPlot and the Bootswatch themes are included with their own licences, under
  `public/vendor/` and `public/themes/`.


// ordering is by color ID in the Breakout protocol
const ordering = {
   'BRX': 1, 'BRK': 2, 'BAM': 3, 'DJK': 4,
   'DAS': 5, 'D2S': 6, 'D3S': 7, 'D4S': 8, 'D5S': 9, 'D6S':10,
   'D7S':11, 'D8S':12, 'D9S':13, 'DTS':14, 'DJS':15, 'DQS':16, 'DKS':17,
   'DAD':18, 'D2D':19, 'D3D':20, 'D4D':21, 'D5D':22, 'D6D':23,
   'D7D':24, 'D8D':25, 'D9D':26, 'DTD':27, 'DJD':28, 'DQD':29, 'DKD':30,
   'DAC':31, 'D2C':32, 'D3C':33, 'D4C':34, 'D5C':35, 'D6C':36,
   'D7C':37, 'D8C':38, 'D9C':39, 'DTC':40, 'DJC':41, 'DQC':42, 'DKC':43,
   'DAH':44, 'D2H':45, 'D3H':46, 'D4H':47, 'D5H':48, 'D6H':49,
   'D7H':50, 'D8H':51, 'D9H':52, 'DTH':53, 'DJH':54, 'DQH':55, 'DKH':56,
   'SIS':57 };

function key_entries(a, b) {
  return a[0] > b[0] ? 1 : -1;
}

// ticker -> color, and back. The Explore API is keyed by colour index, so any
// call built from a currency symbol has to go through here.
const by_color = {};
for (const [ticker, color] of Object.entries(ordering)) {
  by_color[color] = ticker;
}

module.exports = {
  // colour index for a ticker, or undefined if it is not a Breakout currency
  color : function(ticker) {
    return ordering[(ticker || '').toUpperCase()];
  },
  // ticker for a colour index, or undefined
  ticker : function(color) {
    return by_color[color];
  },
  isDeck : function(ticker) {
    return ticker.startsWith('D');
  },
  // every Deck card ticker, in colour order (DJK plus the 52 suited cards)
  deck : function() {
    return Object.keys(ordering).filter(function(t){ return t.charAt(0) === 'D'; });
  },
  isFeeCurrency : function(ticker) {
    return ((ticker == 'BRX') || (ticker == 'BRK') ||
            (ticker == 'BAM') || (ticker == 'SIS'));
  },
  // returns entries array sorted by currency
  sorted : function(obj) {
    var entries = Object.entries(obj);
    entries.sort(key_entries);
    return entries;
  },
  // adds objA to objB (i.e. A + B)
  //    returns entries array sorted by currency
  add : function(objA, objB) {
    let objSum = Object.assign({}, objA);
    for (const [k, v] of Object.entries(objB)) {
      if (k in objSum) {
        objSum[k] += v;
      } else {
        objSum[k] = v;
      }
    }
    return module.exports.sorted(objSum);
  },
  // subtracts objB from objA (i.e. A - B)
  //    returns entries array sorted by currency
  subtract : function(objA, objB) {
    let objDiff = Object.assign({}, objA);
    for (const [k, v] of Object.entries(objB)) {
      if (k in objDiff) {
        objDiff[k] -= v;
      } else {
        objDiff[k] = -v;
      }
    }
    return module.exports.sorted(objDiff);
  }
}

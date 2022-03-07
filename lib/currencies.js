
const ordering = {
   'BRX': 0, 'BRK': 1, 'BAM': 2, 'DJK': 3,
   'DAS': 4, 'D2S': 5, 'D3S': 6, 'D4S': 7, 'D5S': 8, 'D6S': 9,
   'D7S':10, 'D8S':11, 'D9S':12, 'DTS':13, 'DJS':14, 'DQS':15, 'DKS':16,
   'DAD':17, 'D2D':18, 'D3D':19, 'D4D':20, 'D5D':21, 'D6D':22,
   'D7D':23, 'D8D':24, 'D9D':25, 'DTD':26, 'DJD':27, 'DQD':28, 'DKD':29,
   'DAC':30, 'D2C':31, 'D3C':32, 'D4C':33, 'D5C':34, 'D6C':35,
   'D7C':36, 'D8C':37, 'D9C':38, 'DTC':39, 'DJC':40, 'DQC':41, 'DKC':42,
   'DAH':43, 'D2H':44, 'D3H':45, 'D4H':46, 'D5H':47, 'D6H':48,
   'D7H':49, 'D8H':50, 'D9H':51, 'DTH':52, 'DJH':53, 'DQH':54, 'DKH':55,
   'SIS':56 };

key_entries : function(a, b) {
  return a[0] > b[0] ? 1 : -1;
}

module.exports = {
  isDeck : function(ticker) {
    return ticker.startsWith('D');
  }
  isFeeCurrency : function(ticker) {
    return ((ticker == 'BRX') || (ticker == 'BRK') ||
            (ticker == 'BAM') || (ticker == 'SIS'));
  }
  // returns entries array sorted by currency
  sorted : function(obj) {
    var entries = Object.entries(obj);
    entries.sort(key_entries);
    return entries;
  }
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
  }
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

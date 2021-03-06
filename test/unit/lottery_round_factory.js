var assert = require('assert');
var Embark = require('embark');
var sha3Utils = require('../../lib/sha3-utils');
var EmbarkSpec = Embark.initTests({
  embarkConfig: 'test/configs/lottery_round_factory.json'
});
var web3 = EmbarkSpec.web3;

var INVALID_JUMP = /invalid JUMP/;
var OUT_OF_GAS = /out of gas/;

function assertInvalidJump(err) {
  assert.equal(INVALID_JUMP.test(err), true, 'Threw an invalid jump');
}

function Promisify(method) {
  return new Promise(function(resolve, reject) {
    method(function(err, result) {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}

function getReceipt(tx) {
  return Promisify(web3.eth.getTransactionReceipt.bind(web3.eth, tx));
}

function getEvent(contract, event, blockNumber) {
  var filter = contract[event]({ from: blockNumber, to: blockNumber });
  return Promisify(filter.get.bind(filter));
}

function assertGoodReceipt(receipt) {
  assert.notEqual(receipt, undefined, 'Receipt exists');
  assert.ok(receipt.blockHash, 'Has a block hash');
  assert.ok(receipt.transactionHash, 'Has a transaction hash');
  assert.ok(receipt.blockNumber, 'Has a block number');
}


describe('LotteryRoundFactory', function() {
  var saltHash, saltNHash;
  var salt = web3.sha3('secret');
  var N = 12;
  saltHash = web3.sha3(salt, { encoding: 'hex' });
  for(var i = 1; i < N; i++) {
    saltHash = web3.sha3(saltHash, { encoding: 'hex' });
  }
  saltNHash = web3.sha3(sha3Utils.packHex(salt, sha3Utils.uintToHex(N, 8), salt), { encoding: 'hex' });

  var accounts;
  var roundLength = 43200;
  var version = '0.1.2';

  function validateCreatedEvent(version, blockNumber) {
    return getEvent(LotteryRoundFactory, 'LotteryRoundCreated', blockNumber).then(function(results) {
      assert.equal(results.length, 1, 'One event emitted from LotteryRoundFactory');
      var result = results[0];
      assert.equal(result.args.version, '0.1.2');
      return result.args.newRound;
    });
  }

  function getBalance(account) {
    return Promisify(web3.eth.getBalance.bind(web3.eth, account));
  }

  function validateNewRound(roundAddress, _saltHash, _saltNHash) {
    var newRound = LotteryRoundContract.at(roundAddress);
    return Promisify(newRound.saltHash.bind(newRound)).then(function(contractSaltHash) {
      assert.equal(contractSaltHash, _saltHash, 'saltHash is publicly verifiable');
      return Promisify(newRound.saltNHash.bind(newRound));
    }).then(function(contractSaltNHash) {
      assert.equal(contractSaltNHash, _saltNHash, 'saltNHash is publicly verifiable');
    });
  }

  function validateStartedEvent(roundAddress, _saltHash, _saltNHash, _closingBlock, _version, blockNumber) {
    var contract = LotteryRoundContract.at(roundAddress);
    return getEvent(contract, 'LotteryRoundStarted', blockNumber).then(function(results) {
      assert.equal(results.length, 1, 'Only one event logged');
      var result = results[0];
      assert.equal(result.args.saltHash, _saltHash, 'Logs the proper saltHash');
      assert.equal(result.args.saltNHash, _saltNHash, 'Logs the proper saltNHash');
      assert.equal(result.args.closingBlock, _closingBlock, 'Logs the proper closingBlock');
      assert.equal(result.args.version, _version, 'Logs the proper version');
      return result.args.picks;
    });
  }

  before(function(done) {
    web3.eth.getAccounts(function(err, acc) {
      if (err) {
        return done(err);
      }
      accounts = acc;
      done();
    });
  });

  describe('deployment', function() {
    before(function(done) {
      var contractsConfig = {
        LotteryRoundFactory: {
          gas: '4000000'
        }
      };

      EmbarkSpec.deployAll(contractsConfig, done);
    });

    it('deploys successfully', function() {
      assert.notEqual(LotteryRoundFactory.address, 'undefined', 'Actually is deployed');
    });
  });

  describe('.createRound', function() {
    before(function(done) {
      var contractsConfig = {
        LotteryRoundFactory: {
          gas: '4000000'
        }
      };

      EmbarkSpec.deployAll(contractsConfig, done);
    });

    it('can create a LotteryRound with verifiable parameters', function() {
      return Promisify(LotteryRoundFactory.createRound.bind(LotteryRoundFactory, saltHash, saltNHash, { gas: '2000000' })).then(function(tx) {
        return getReceipt(tx);
      }).then(function(receipt) {
        assertGoodReceipt(receipt);
        return validateCreatedEvent(receipt.blockNumber).then(function(roundAddress) {
          return validateNewRound(roundAddress, saltHash, saltNHash).then(function() {
            return getBalance(roundAddress);
          }).then(function(newRoundBalance) {
            assert.equal(newRoundBalance.equals(0), true, 'has no initial balance.');
            return validateStartedEvent(roundAddress, saltHash, saltNHash, receipt.blockNumber + roundLength, version, receipt.blockNumber);
          });
        });
      });
    });

    it('can create a LotteryRound with verifiable parameters and an initial balance', function() {
      var balance = web3.toWei(10, 'ether');
      return Promisify(LotteryRoundFactory.createRound.bind(LotteryRoundFactory, saltHash, saltNHash, { gas: '2000000', value: balance })).then(function(tx) {
        return getReceipt(tx);
      }).then(function(receipt) {
        assertGoodReceipt(receipt);
        return validateCreatedEvent(receipt.blockNumber);
      }).then(function(roundAddress) {
        return validateNewRound(roundAddress, saltHash, saltNHash).then(function() {
          return getBalance(roundAddress);
        }).then(function(newRoundBalance) {
          assert.equal(newRoundBalance.equals(web3.toBigNumber(balance)), true, 'has the full initial balance.');
        });
      });
    });

    it('a non-owner cannot create a round', function() {
      return Promisify(LotteryRoundFactory.createRound.bind(LotteryRoundFactory, saltHash, saltNHash, { gas: '2000000', from: accounts[1] })).then(function(txhash) {
        assert.equal(txhash, undefined, 'Should not succeed.');
      }).catch(function(err) {
        assertInvalidJump(err);
      });
    });
  });
});

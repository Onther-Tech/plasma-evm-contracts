const { createCurrency } = require('@makerdao/currency');

const _WTON = createCurrency('WTON');

const RootChain = artifacts.require('RootChain');
const TON = artifacts.require('TON');
const WTON = artifacts.require('WTON');
const RootChainRegistry = artifacts.require('RootChainRegistry');
const DepositManager = artifacts.require('DepositManager');
const SeigManager = artifacts.require('SeigManager');
const CoinageFactory = artifacts.require('CoinageFactory');
const PowerTON = artifacts.require('PowerTON');
const DAOVault = artifacts.require('DAOVault');

// 1024 blocks
// 93046 blocks (= 2 weeks)
const WITHDRAWAL_DELAY_MAINNET = 93046;
const WITHDRAWAL_DELAY_RINKEBY = Math.floor(WITHDRAWAL_DELAY_MAINNET / (14 * 24 * 2)); // 30 min

// 1209600 sec (= 2 weeks)
const ROUND_DURATION_MAINNET = 1209600;
const ROUND_DURATION_RINKEBY = Math.floor(ROUND_DURATION_MAINNET / (14 * 24 * 2)); // 30 min

// 100 WTON per block as seigniorage
const SEIG_PER_BLOCK = process.env.SEIG_PER_BLOCK || '3.91615931';

const TON_MAINNET = process.env.TON_MAINNET;
const TON_RINKEBY = process.env.TON_RINKEBY;

module.exports = async function (deployer, network) {
  if (process.env.DEPLOY) {
    // rinkeby TON: 0x3734E35231abE68818996dC07Be6a8889202DEe9, mainnet TON: 0x2be5e8c109e2197d077d13a82daead6a9b3433c5
    const tonAddr = network.includes('mainnet')
      ? TON_MAINNET : network.includes('rinkeby')
        ? TON_RINKEBY
        : undefined;

    const withdrawalDelay = network.includes('mainnet')
      ? WITHDRAWAL_DELAY_MAINNET : network.includes('rinkeby')
        ? WITHDRAWAL_DELAY_RINKEBY
        : undefined;

    const roundDuration = network.includes('mainnet')
      ? ROUND_DURATION_MAINNET : network.includes('rinkeby')
        ? ROUND_DURATION_RINKEBY
        : undefined;

    console.log('Using TON deployed at', tonAddr);

    const ton = tonAddr ? await TON.at(tonAddr) : await deployer.deploy(TON);

    // const rootchain = await RootChain.deployed();
    // const ton = await deployer.deploy(TON);
    // console.log(ton);
    const wton = await deployer.deploy(WTON, ton.address);
    const registry = await deployer.deploy(RootChainRegistry);
    const depositManager = await deployer.deploy(
      DepositManager,
      wton.address,
      registry.address,
      withdrawalDelay,
    );
    const factory = await deployer.deploy(CoinageFactory);
    const daoVault = await deployer.deploy(DAOVault, ton.address, 0); // TODO: set timestamp parameter
    const seigManager = await deployer.deploy(
      SeigManager,
      ton.address,
      wton.address,
      registry.address,
      depositManager.address,
      _WTON(SEIG_PER_BLOCK).toFixed('ray'),
      factory.address,
    );

    const powerton = await deployer.deploy(
      PowerTON,
      seigManager.address,
      wton.address,
      roundDuration,
    );

    const addrs = {
      TON: ton.address,
      WTON: wton.address,
      RootChainRegistry: registry.address,
      DepositManager: depositManager.address,
      SeigManager: seigManager.address,
      PowerTON: powerton.address,
    };

    console.log(JSON.stringify(addrs, null, 2));

    await factory.setSeigManager(seigManager.address);
    await seigManager.setDao(daoVault.address);

    console.log('Initialize PowerTON...');
    await powerton.init();

    console.log('Set PowerTON to SeigManager...');
    await seigManager.setPowerTON(powerton.address);

    // add WTON minter role to seig manager
    console.log('Add WTON Minter Role to SeigManager...');
    await wton.addMinter(seigManager.address);

    console.log('Add TON Minter Role to WTON...');
    await ton.addMinter(wton.address);

    // set seig manager to contracts
    console.log('Set SeigManager to WTON and DepositManager...');
    await Promise.all([
      depositManager,
      wton,
    ].map(contract => contract.setSeigManager(seigManager.address)));

    console.log('Start PowerTON...');
    await powerton.start();
  }
};

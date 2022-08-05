import { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import chai from 'chai';
import { Contract, ContractFactory, ContractInterface, Signer, Wallet } from 'ethers';
import { TransactionResponse } from '@ethersproject/abstract-provider';
import { Provider } from '@ethersproject/providers';
import { getStatic } from 'ethers/lib/utils';
import { wallet } from '.';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { given, when, then } from './bdd';

chai.use(chaiAsPromised);

type Impersonator = Signer | Provider | string;

export const checkTxRevertedWithMessage = async ({
  tx,
  message,
}: {
  tx: Promise<TransactionResponse>;
  message: RegExp | string;
}): Promise<void> => {
  await expect(tx).to.be.reverted;
  if (message instanceof RegExp) {
    await expect(tx).eventually.rejected.have.property('message').match(message);
  } else {
    await expect(tx).to.be.revertedWith(message);
  }
};

export const checkTxRevertedWithCustomError = async ({
  tx,
  contract,
  customErrorName,
}: {
  tx: Promise<TransactionResponse>;
  contract: { interface: any };
  customErrorName: string;
}): Promise<void> => {
  await expect(tx).to.be.revertedWithCustomError(contract, customErrorName);
};

export const deployShouldRevertWithCustomError = async ({
  contract,
  args,
  customErrorName,
}: {
  contract: ContractFactory;
  args: any[];
  customErrorName: string;
}): Promise<void> => {
  const deployContractTx = await contract.getDeployTransaction(...args);
  const tx = contract.signer.sendTransaction(deployContractTx);
  await checkTxRevertedWithCustomError({ tx, contract, customErrorName });
};

export const checkTxRevertedWithZeroAddress = async (tx: Promise<TransactionResponse>): Promise<void> => {
  await checkTxRevertedWithMessage({
    tx,
    message: /zero\saddress/,
  });
};

export const deployShouldRevertWithZeroAddress = async ({ contract, args }: { contract: ContractFactory; args: any[] }): Promise<void> => {
  const deployContractTx = await contract.getDeployTransaction(...args);
  const tx = contract.signer.sendTransaction(deployContractTx);
  await checkTxRevertedWithZeroAddress(tx);
};

export const deployShouldRevertWithMessage = async ({
  contract,
  args,
  message,
}: {
  contract: ContractFactory;
  args: any[];
  message: string;
}): Promise<void> => {
  const deployContractTx = await contract.getDeployTransaction(...args);
  const tx = contract.signer.sendTransaction(deployContractTx);
  await checkTxRevertedWithMessage({ tx, message });
};

export const txShouldRevertWithZeroAddress = async ({
  contract,
  func,
  args,
}: {
  contract: Contract;
  func: string;
  args: any[];
  tx?: Promise<TransactionResponse>;
}): Promise<void> => {
  const tx = contract[func](...args);
  await checkTxRevertedWithZeroAddress(tx);
};

export const txShouldRevertWithMessage = async ({
  contract,
  func,
  args,
  message,
}: {
  contract: Contract;
  func: string;
  args: any[];
  message: string;
}): Promise<void> => {
  const tx = contract[func](...args);
  await checkTxRevertedWithMessage({ tx, message });
};

export const checkTxEmittedEvents = async ({
  contract,
  tx,
  events,
}: {
  contract: Contract;
  tx: TransactionResponse;
  events: { name: string; args: any[] }[];
}): Promise<void> => {
  for (let i = 0; i < events.length; i++) {
    await expect(tx)
      .to.emit(contract, events[i].name)
      .withArgs(...events[i].args);
  }
};

export const deployShouldSetVariablesAndEmitEvents = async ({
  contract,
  args,
  settersGettersVariablesAndEvents,
}: {
  contract: ContractFactory;
  args: any[];
  settersGettersVariablesAndEvents: {
    getterFunc: string;
    variable: any;
    eventEmitted: string;
  }[];
}): Promise<void> => {
  const deployContractTx = await contract.getDeployTransaction(...args);
  const tx = await contract.signer.sendTransaction(deployContractTx);
  const address = getStatic<(tx: TransactionResponse) => string>(contract.constructor, 'getContractAddress')(tx);
  const deployedContract = getStatic<(address: string, contractInterface: ContractInterface, signer?: Signer) => Contract>(
    contract.constructor,
    'getContract'
  )(address, contract.interface, contract.signer);
  await txShouldHaveSetVariablesAndEmitEvents({
    contract: deployedContract,
    tx,
    settersGettersVariablesAndEvents,
  });
};

export const txShouldHaveSetVariablesAndEmitEvents = async ({
  contract,
  tx,
  settersGettersVariablesAndEvents,
}: {
  contract: Contract;
  tx: TransactionResponse;
  settersGettersVariablesAndEvents: {
    getterFunc: string;
    variable: any;
    eventEmitted: string;
  }[];
}): Promise<void> => {
  for (let i = 0; i < settersGettersVariablesAndEvents.length; i++) {
    await checkTxEmittedEvents({
      contract,
      tx,
      events: [
        {
          name: settersGettersVariablesAndEvents[i].eventEmitted,
          args: [settersGettersVariablesAndEvents[i].variable],
        },
      ],
    });
    expect(await contract[settersGettersVariablesAndEvents[i].getterFunc]()).to.eq(settersGettersVariablesAndEvents[i].variable);
  }
};

export const txShouldSetVariableAndEmitEvent = async ({
  contract,
  setterFunc,
  getterFunc,
  variable,
  eventEmitted,
}: {
  contract: Contract;
  setterFunc: string;
  getterFunc: string;
  variable: any;
  eventEmitted: string;
}): Promise<void> => {
  expect(await contract[getterFunc]()).to.not.eq(variable);
  const tx = contract[setterFunc](variable);
  await txShouldHaveSetVariablesAndEmitEvents({
    contract,
    tx,
    settersGettersVariablesAndEvents: [
      {
        getterFunc,
        variable,
        eventEmitted,
      },
    ],
  });
};

export const shouldBeExecutableOnlyByGovernor = ({
  contract,
  funcAndSignature,
  params,
  governor,
}: {
  contract: () => Contract;
  funcAndSignature: string;
  params?: any[] | (() => any[]);
  governor: () => SignerWithAddress | Wallet;
}) => {
  let realParams: any[];
  given(() => {
    realParams = typeof params === 'function' ? params() : params ?? [];
  });
  when('not called from governor', () => {
    let onlyGovernorAllowedTx: Promise<TransactionResponse>;
    given(async () => {
      const notGovernor = await wallet.generateRandom();
      onlyGovernorAllowedTx = contract()
        .connect(notGovernor)
        [funcAndSignature](...realParams!);
    });
    then('tx is reverted with reason', async () => {
      await expect(onlyGovernorAllowedTx).to.be.revertedWithCustomError(contract(), 'OnlyGovernor');
    });
  });
  when('called from governor', () => {
    let onlyGovernorAllowedTx: Promise<TransactionResponse>;
    given(async () => {
      onlyGovernorAllowedTx = contract()
        .connect(governor())
        [funcAndSignature](...realParams!);
    });
    then('tx is not reverted or not reverted with reason only governor', async () => {
      await expect(onlyGovernorAllowedTx).to.not.be.revertedWithCustomError(contract(), 'OnlyGovernor');
    });
  });
};

import { DelegatorReward, User, IbcEvent, Transfer, Transaction, ActiveUser } from "../types";
import { CosmosEvent, CosmosTransaction } from "@subql/types-cosmos";
import assert from "assert";

export async function handleDelegatorRewardEvent(event: CosmosEvent): Promise<void> {
  // We create a new entity using the transaction hash and message index as a unique ID
  logger.info(
    `New delegator reward event at block ${event.block.block.header.height}`
  );

  assert(
    event.msg.tx.decodedTx.authInfo.fee,
    "missing fee in decodeTx.authInfo"
  );
  const newDelegatorReward = DelegatorReward.create({
    id: `${event.tx.hash}-${event.msg.idx}-${event.idx}`,
    blockHeight: BigInt(event.block.block.header.height),
    blockTimestamp: new Date(event.block.header.time.toISOString()),
    txHash: event.tx.hash,
    delegatorAddress: event.msg.msg.decodedMsg.delegatorAddress,
    validatorAddress: event.msg.msg.decodedMsg.validatorAddress,
    feeAmount: event.msg.tx.decodedTx.authInfo.fee.amount[0].amount,
    feeDenomination: event.msg.tx.decodedTx.authInfo.fee.amount[0].denom,
  });

  // Cosmos events code attributes as an array of key value pairs, we're looking for an amount
  for (const attr of event.event.attributes) {
    if (attr.key === "amount") {
      newDelegatorReward.rewardAmount = attr.value;
    }
  }
  await newDelegatorReward.save();
}

interface EssentialValues {
  sender?: string;
  amount?: number;
  denom?: string;
  receiver?: string;
  sequence?: string;
}

async function checkGetUser(user: string, blockTimestamp: Date): Promise<User> {
  let userRecord = await User.get(user.toLowerCase());
  if (!userRecord) {
    userRecord = User.create({
      id: user.toLowerCase(),
      blockTimestamp: blockTimestamp,
    });
    await userRecord.save();
  }

  let activeUserRecord = ActiveUser.create({
    id: `${user.toLowerCase()}-${blockTimestamp.toISOString()}`,
    walletAddress: user.toLowerCase(),
    blockTimestamp: blockTimestamp,
  });
  await activeUserRecord.save();

  return userRecord;
}

async function getEssensialValues(
  event: CosmosEvent
): Promise<EssentialValues> {
  let sender;
  let amount;
  let denom;
  let receiver;
  let sequence;
  for (const attr of event.event.attributes) {
    switch (attr.key) {
      case "packet_data":
        sender = JSON.parse(attr.value)["sender"];
        receiver = JSON.parse(attr.value)["receiver"];
        amount = JSON.parse(attr.value)["amount"];
        denom = JSON.parse(attr.value)["denom"];
        break;
      case "packet_sequence":
        sequence = attr.value;
        break;
      default:
        break;
    }
  }
  return { sender, amount, denom, receiver, sequence };
}

async function populateValuesFromSource(
  sender: string,
  amount: string,
  denom: string,
  receiver: string,
  sequence: string,
  event: CosmosEvent,
  type: string
) {
  let bridgeTransactionRecord = await IbcEvent.get(sequence);
  const blockTimestamp = new Date(event.block.header.time.toISOString());
  if (!bridgeTransactionRecord) {
    bridgeTransactionRecord = IbcEvent.create({
      id: sequence,
      blockHeight: BigInt(event.block.block.header.height),
      blockTimestamp: blockTimestamp,
      txHash: event.tx.hash,
      senderId: (await checkGetUser(sender, blockTimestamp)).id,
      receiverId: (await checkGetUser(receiver, blockTimestamp)).id,
      sourceChain: event.block.header.chainId,
      sourceChainTransaction: event.tx.hash.toString(),
      amount: BigInt(amount),
      denom: denom,
      type: type,
    });
  } else {
    bridgeTransactionRecord.sourceChain = event.block.header.chainId;
    bridgeTransactionRecord.sourceChainTransaction = event.tx.hash.toString();
  }
  await bridgeTransactionRecord.save();
}

async function populateValuesFromDestination(
  sender: string,
  amount: string,
  denom: string,
  receiver: string,
  sequence: string,
  event: CosmosEvent,
  type: string
) {
  let bridgeTransactionRecord = await IbcEvent.get(sequence);
  const blockTimestamp = new Date(event.block.header.time.toISOString());
  if (!bridgeTransactionRecord) {
    bridgeTransactionRecord = IbcEvent.create({
      id: sequence,
      blockHeight: BigInt(event.block.block.header.height),
      blockTimestamp: blockTimestamp,
      txHash: event.tx.hash,
      senderId: (await checkGetUser(sender, blockTimestamp)).id,
      receiverId: (await checkGetUser(receiver, blockTimestamp)).id,
      destinationChain: event.block.header.chainId,
      destinationChainTransaction: event.tx.hash.toString(),
      amount: BigInt(amount),
      denom: denom,
      type: type,
    });
  } else {
    bridgeTransactionRecord.destinationChain = event.block.header.chainId;
    bridgeTransactionRecord.destinationChainTransaction =
      event.tx.hash.toString();
  }
  await bridgeTransactionRecord.save();
}

export async function handleIBCReceiveEvent(
  event: CosmosEvent
): Promise<void> {
  logger.info(
    `Handling an incoming transfer event on Persistence from ${event.tx.hash.toString()}`
  );

  const { sender, amount, denom, receiver, sequence } = await getEssensialValues(
    event
  );
  if (sequence && sender && receiver && amount && denom) {
    populateValuesFromDestination(
      sender,
      amount.toString(),
      denom,
      receiver,
      sequence,
      event,
      "in"
    );
  }
}

export async function handleIBCSendEvent(
  event: CosmosEvent
): Promise<void> {
  logger.info(
    `Handling an outgoing transfer event on Persistence from ${event.tx.hash.toString()}`
  );

  const { sender, amount, denom, receiver, sequence } = await getEssensialValues(
    event
  );

  if (sequence && sender && receiver && amount && denom) {
    populateValuesFromSource(
      sender,
      amount.toString(),
      denom,
      receiver,
      sequence,
      event,
      "out"
    );
  }
}

export async function handleTransferEvent(event: CosmosEvent): Promise<void> {
  const blockTimestamp = new Date(event.block.header.time.toISOString());
  const eventRecord = Transfer.create({
    id: `${event.tx.hash}-${event.msg.idx}-${event.idx}`,
    blockHeight: BigInt(event.block.block.header.height),
    blockTimestamp: blockTimestamp,
    txHash: event.tx.hash,
    toAddress: "",
    amount: "",
    fromAddress: "",
  });
  for (const attr of event.event.attributes) {
    switch (attr.key) {
      case "recipient":
        eventRecord.toAddress = (await checkGetUser(attr.value, blockTimestamp)).id;
        break;
      case "amount":
        eventRecord.amount = attr.value;
        break;
      case "sender":
        eventRecord.fromAddress = (await checkGetUser(attr.value, blockTimestamp)).id;
        break;
      default:
        break;
    }
  }
  await eventRecord.save();
}

export async function handleTransaction(tx: CosmosTransaction): Promise<void> {
  const blockTimestamp = new Date(tx.block.block.header.time.toISOString());
  const transactionRecord = Transaction.create({
    id: `${tx.block.block.header.height}-${tx.hash}`,
    blockHeight: BigInt(tx.block.block.header.height),
    blockTimestamp: blockTimestamp,
    txHash: tx.hash,
  });
  await transactionRecord.save();

  // iterate over all events in the transaction and get user addresses
  for (const event of tx.tx.events) {
    for (const attr of event.attributes) {
      if (attr.key === "sender") {
        (await checkGetUser(attr.value, blockTimestamp)).id
      }
      if (attr.key === "recipient") {
        (await checkGetUser(attr.value, blockTimestamp)).id
      }
    }
  }
}

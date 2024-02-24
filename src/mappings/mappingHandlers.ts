import { DelegatorReward, User, IbcEvent, Transfer, Transaction, HourlyTxSnapshot, DailyTxSnapshot, MonthlyTxSnapshot } from "../types";
import { CosmosEvent, CosmosTransaction } from "@subql/types-cosmos";
import assert from "assert";

export async function handleEvent(event: CosmosEvent): Promise<void> {
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
  receiver?: string;
  sequence?: string;
}

async function checkGetUser(user: string): Promise<User> {
  let userRecord = await User.get(user.toLowerCase());
  if (!userRecord) {
    userRecord = User.create({
      id: user.toLowerCase(),
    });
    await userRecord.save();
  }
  return userRecord;
}

async function getEssensialValues(
  event: CosmosEvent
): Promise<EssentialValues> {
  let sender;
  let amount;
  let receiver;
  let sequence;
  for (const attr of event.event.attributes) {
    switch (attr.key) {
      case "packet_data":
        sender = JSON.parse(attr.value)["sender"];
        receiver = JSON.parse(attr.value)["receiver"];
        amount = JSON.parse(attr.value)["amount"];
        break;
      case "packet_sequence":
        sequence = attr.value;
        break;
      default:
        break;
    }
  }
  return { sender, amount, receiver, sequence };
}

async function populateValuesFromSource(
  sender: string,
  amount: string,
  receiver: string,
  sequence: string,
  event: CosmosEvent,
  type: string
) {
  let bridgeTransactionRecord = await IbcEvent.get(sequence);
  if (!bridgeTransactionRecord) {
    bridgeTransactionRecord = IbcEvent.create({
      id: sequence,
      blockHeight: BigInt(event.block.block.header.height),
      blockTimestamp: new Date(event.block.header.time.toISOString()),
      txHash: event.tx.hash,
      senderId: (await checkGetUser(sender)).id,
      receiverId: (await checkGetUser(receiver)).id,
      sourceChain: event.block.header.chainId,
      sourceChainTransaction: event.tx.hash.toString(),
      amount: BigInt(amount),
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
  receiver: string,
  sequence: string,
  event: CosmosEvent,
  type: string
) {
  let bridgeTransactionRecord = await IbcEvent.get(sequence);
  if (!bridgeTransactionRecord) {
    bridgeTransactionRecord = IbcEvent.create({
      id: sequence,
      blockHeight: BigInt(event.block.block.header.height),
      blockTimestamp: new Date(event.block.header.time.toISOString()),
      txHash: event.tx.hash,
      senderId: (await checkGetUser(sender)).id,
      receiverId: (await checkGetUser(receiver)).id,
      destinationChain: event.block.header.chainId,
      destinationChainTransaction: event.tx.hash.toString(),
      amount: BigInt(amount),
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

  const { sender, amount, receiver, sequence } = await getEssensialValues(
    event
  );
  if (sequence && sender && receiver && amount) {
    populateValuesFromDestination(
      sender,
      amount.toString(),
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

  const { sender, amount, receiver, sequence } = await getEssensialValues(
    event
  );

  if (sequence && sender && receiver && amount) {
    populateValuesFromSource(
      sender,
      amount.toString(),
      receiver,
      sequence,
      event,
      "out"
    );
  }
}

export async function handleTransferEvent(event: CosmosEvent): Promise<void> {
  const eventRecord = Transfer.create({
    id: `${event.tx.hash}-${event.msg.idx}-${event.idx}`,
    blockHeight: BigInt(event.block.block.header.height),
    blockTimestamp: new Date(event.block.header.time.toISOString()),
    txHash: event.tx.hash,
    toAddress: "",
    amount: "",
    fromAddress: "",
  });
  for (const attr of event.event.attributes) {
    switch (attr.key) {
      case "recipient":
        eventRecord.toAddress = attr.value;
        break;
      case "amount":
        eventRecord.amount = attr.value;
        break;
      case "sender":
        eventRecord.fromAddress = attr.value;
        break;
      default:
        break;
    }
  }
  await eventRecord.save();
}

export async function handleTransaction(tx: CosmosTransaction): Promise<void> {
  const transactionRecord = Transaction.create({
    id: `${tx.block.block.header.height}-${tx.hash}`,
    blockHeight: BigInt(tx.block.block.header.height),
    blockTimestamp: new Date(tx.block.block.header.time.toISOString()),
    txHash: tx.hash,
  });
  await transactionRecord.save();

  const blockHour = tx.block.block.header.time.getUTCHours();
  const blockDay = tx.block.block.header.time.getUTCDay();
  const blockMonth = tx.block.block.header.time.getUTCMonth();
  const blockYear = tx.block.block.header.time.getUTCFullYear();

  // iterate over all events in the transaction and get user addresses
  for (const event of tx.tx.events) {
    for (const attr of event.attributes) {
      if (attr.key === "sender") {
        checkGetUser(attr.value)
      }
      if (attr.key === "recipient") {
        checkGetUser(attr.value)
      }
    }
  }

  // save tx count and volume for the hour
  let hourRecordID = `${blockYear}-${blockMonth}-${blockDay}-${blockHour}`;
  const hourRecord = await HourlyTxSnapshot.get(hourRecordID);
  if (!hourRecord) {
    const newHourRecord = HourlyTxSnapshot.create({
      id: hourRecordID,
      lastBlockHeight: BigInt(tx.block.block.header.height),
      lastBlockTimestamp: new Date(tx.block.block.header.time.toISOString()),
      txCount: BigInt(1),
    });
    await newHourRecord.save();
  } else {
    hourRecord.txCount += BigInt(1);
    hourRecord.lastBlockHeight = BigInt(tx.block.block.header.height);
    hourRecord.lastBlockTimestamp = new Date(tx.block.block.header.time.toISOString());
    await hourRecord.save();
  }

  // save tx count and volume for the day
  let dayRecordID = `${blockYear}-${blockMonth}-${blockDay}`;
  const dayRecord = await DailyTxSnapshot.get(dayRecordID);
  if (!dayRecord) {
    const newDayRecord = DailyTxSnapshot.create({
      id: dayRecordID,
      lastBlockHeight: BigInt(tx.block.block.header.height),
      lastBlockTimestamp: new Date(tx.block.block.header.time.toISOString()),
      txCount: BigInt(1),
    });
    await newDayRecord.save();
  } else {
    dayRecord.txCount += BigInt(1);
    dayRecord.lastBlockHeight = BigInt(tx.block.block.header.height);
    dayRecord.lastBlockTimestamp = new Date(tx.block.block.header.time.toISOString());
    await dayRecord.save();
  }

  // save tx count and volume for the month
  let monthRecordID = `${blockYear}-${blockMonth}`;
  const monthRecord = await MonthlyTxSnapshot.get(monthRecordID);
  if (!monthRecord) {
    const newMonthRecord = MonthlyTxSnapshot.create({
      id: monthRecordID,
      lastBlockHeight: BigInt(tx.block.block.header.height),
      lastBlockTimestamp: new Date(tx.block.block.header.time.toISOString()),
      txCount: BigInt(1),
    });
    await newMonthRecord.save();
  } else {
    monthRecord.txCount += BigInt(1);
    monthRecord.lastBlockHeight = BigInt(tx.block.block.header.height);
    monthRecord.lastBlockTimestamp = new Date(tx.block.block.header.time.toISOString());
    await monthRecord.save();
  }
}

import {
  CosmosDatasourceKind,
  CosmosHandlerKind,
  CosmosProject,
} from "@subql/types-cosmos";

// Can expand the Datasource processor types via the genreic param
const project: CosmosProject = {
  specVersion: "1.0.0",
  version: "0.0.1",
  name: "persistence-starter",
  description:
    "This project can be use as a starting point for developing your Cosmos persistence based SubQuery project",
  runner: {
    node: {
      name: "@subql/node-cosmos",
      version: ">=3.0.0",
    },
    query: {
      name: "@subql/query",
      version: "*",
    },
  },
  schema: {
    file: "./schema.graphql",
  },
  network: {
    /* The unique chainID of the Cosmos Zone */
    chainId: "core-1",
    /**
     * These endpoint(s) should be public non-pruned archive node
     * We recommend providing more than one endpoint for improved reliability, performance, and uptime
     * Public nodes may be rate limited, which can affect indexing speed
     * When developing your project we suggest getting a private API key
     * If you use a rate limited endpoint, adjust the --batch-size and --workers parameters
     * These settings can be found in your docker-compose.yaml, they will slow indexing but prevent your project being rate limited
     */
    endpoint: ["https://r-persistence-archive-sub--atnqqmfffe9qgz02sjhwcnk35nu4vil6.gw.notionalapi.com/"],
    chaintypes: new Map([
      [
        "cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward",
        {
          // CIRCUMVENTING VIA ORDER
          file: "./proto/cosmos/distribution/v1beta1/tx.proto",
          messages: ["MsgWithdrawDelegatorReward"],
        },
      ],
    ]),
  },
  dataSources: [
    {
      kind: CosmosDatasourceKind.Runtime,
      startBlock: 1,
      mapping: {
        file: "./dist/index.js",
        handlers: [
          {
            handler: "handleDelegatorRewardEvent",
            kind: CosmosHandlerKind.Event,
            filter: {
              type: "coin_spent",
              messageFilter: {
                type: "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward",
              },
            },
          },
          {
            handler: "handleIBCReceiveEvent",
            kind: CosmosHandlerKind.Event,
            filter: {
              type: "recv_packet",
              messageFilter: {
                type: "/ibc.core.channel.v1.MsgRecvPacket",
              },
            },
          },
          {
            handler: "handleIBCSendEvent",
            kind: CosmosHandlerKind.Event,
            filter: {
              type: "send_packet",
              messageFilter: {
                type: "/ibc.applications.transfer.v1.MsgTransfer",
              },
            },
          },
          {
            handler: "handleTransferEvent",
            kind: CosmosHandlerKind.Event,
            filter: {
              type: "transfer",
              messageFilter: {
                type: "/cosmos.bank.v1beta1.MsgSend",
              },
            },
          },
          {
            handler: "handleTransferEvent",
            kind: CosmosHandlerKind.Event,
            filter: {
              type: "transfer",
              messageFilter: {
                type: "/cosmos.bank.v1beta1.MsgReceive",
              },
            },
          },
          {
            handler: "handleTransaction",
            kind: CosmosHandlerKind.Transaction,
            filter: {
              includeFailedTx: false,
            },
          },
        ],
      },
    },
  ],
};

// Must set default to the project instance
export default project;

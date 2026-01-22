const mongoose = require("mongoose");

const DeviceSchema = new mongoose.Schema(
  {
    ports: [{ type: mongoose.Schema.Types.ObjectId, ref: "ports" }],
    macId: {
      type: String,
      require: true,
      unique: true,
    },
    deviceId: {
      type: String,
      require: true,
      unique: true,
    },
    dType: {
      type: String,
      require: true,
    },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "clients" },
    lp: {
      type: Date,
      require: true,
    },
    ns: {
      type: String,
      require: true,
    },
    version: {
      type: String,
      require: true,
    },
    online: {
      type: Boolean,
      default: true,
    },
    configured: {
      type: Boolean,
      default: true,
    },
    last_change: {
      type: Date,
    },
    status: {
      type: String,
    },
    algorithm_type: {
      type: String,
    },
    protocolname: {
      type: String,
    },
    modelnumber: {
      type: String,
    },
    proto_updatedAt: {
      type: Date,
    },
    AV1_ENABLE: {
      type: Boolean,
      default: false,
    },
    AV1_PENDING_STATUS: {
      type: Boolean,
      default: false,
    },
    AV2_ENABLE: {
      type: Boolean,
      default: false,
    },
    AV2_PENDING_STATUS: {
      type: Boolean,
      default: false,
    },
    live_algo_status: String,
    // AV2_ENABLE: {
    //   type: String,
    // },
    // AV2_DISABLE: {
    //   type: String,
    // },
    IS_MAINTENANCE: {
      type: Boolean,
      default: false,
    },
    IS_PREDICTIVE_MAINTENANCE: {
      type: Boolean,
      default: false,
    },
    PREDICTIVE_MAINTENANCE_CAUSE: [
      {
        type: String,
      },
    ],
    MAINTENANCE_CAUSE: {
      problemSelectedByUser: [
        {
          type: String,
        },
      ],
      customProblemGivenByUser: {
        type: String,
      },
    },
    actualDate_MAINTENANCE: {
      type: Date,
    },
    severity: {
      type: String,
    },
    ticket_RAISEDBY: {
      type: String,
      enum: ["system", "user", null],
    },
    updatedAt_PREDICTIVE_MAINTENANCE_IN: {
      type: Date,
    },
    updatedAt_PREDICTIVE_MAINTENANCE_OUT: {
      type: Date,
    },
    updatedAt_MAINTENANCE: {
      type: Date,
    },
    ticketId: {
      type: String,
    },
    configuredTimezone: {
      type: String,
    },
    isTimeAcknowledge: {
      type: Boolean,
      default: true,
    },
    totalLTChildTemp: {
      type: mongoose.Schema.Types.Double,
    },
    numLTChildTemp: {
      type: mongoose.Schema.Types.Int32,
    },
  },
  { timestamps: true },
  { strict: false }
);
let Devices = mongoose.model("devices", DeviceSchema);

module.exports = {
  devices: Devices,
};

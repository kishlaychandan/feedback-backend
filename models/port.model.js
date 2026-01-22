const { Schema, model } = require("mongoose");

const portSchema = new Schema(
  {
    device: {
      type: Schema.Types.ObjectId,
    },
    title: {
      type: String,
      default: "Switch",
    },
    no: {
      type: String,
    },
    val: {
      type: Number,
      default: 0,
    },
    ac_mode: {
      type: Number,
    },
    ac_temp: {
      type: Number,
    },
    ac_fan_speed: {
      type: Number,
    },
    cat: {
      type: String,
      enum: ["s", "p"], // s=> Regular on off swithc, p=> slider/potentiometer switch,
      // required: [true, "Please specify load type"]
    },
    status: {
      type: String,
      default: null,
    },
    mac: {
      type: String,
    },
    groupId: {
      type: Schema.Types.ObjectId,
    },
    portType: {
      type: String,
      default: "Bulb",
    },
    portIcon: {
      type: String,
      default: "bulb",
    },
    deviceOnline: {
      type: Boolean,
    },
    roomTemp: {
      type: String,
    },
    is_set_points_locked: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);
const Port = model("Port", portSchema);
module.exports = {
  Port,
};
// export const Port = model("Port", portSchema);

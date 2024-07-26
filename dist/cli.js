#!/usr/bin/env node
'use strict';

var require$$0 = require('commander');
var index = require('./index-BJpm7sOi.js');
var fs = require('fs');
var child_process = require('child_process');
require('snarkjs');
require('circom_tester');
require('fs/promises');
require('crypto');
require('loglevel');
require('https');
require('node:assert');

function getDefaultExportFromCjs (x) {
	return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, 'default') ? x['default'] : x;
}

var extraTypings = {exports: {}};

(function (module, exports) {
	const commander = require$$0;

	// @ts-check

	exports = module.exports = {};

	// Return a different global program than commander,
	// and don't also return it as default export.
	exports.program = new commander.Command();

	/**
	 * Expose classes. The FooT versions are just types, so return Commander original implementations!
	 */

	exports.Argument = commander.Argument;
	exports.Command = commander.Command;
	exports.CommanderError = commander.CommanderError;
	exports.Help = commander.Help;
	exports.InvalidArgumentError = commander.InvalidArgumentError;
	exports.InvalidOptionArgumentError = commander.InvalidArgumentError; // Deprecated
	exports.Option = commander.Option;

	// In Commander, the create routines end up being aliases for the matching
	// methods on the global program due to the (deprecated) legacy default export.
	// Here we roll our own, the way Commander might in future.
	exports.createCommand = (name) => new commander.Command(name);
	exports.createOption = (flags, description) => new commander.Option(flags, description);
	exports.createArgument = (name, description) => new commander.Argument(name, description); 
} (extraTypings, extraTypings.exports));

var extraTypingsExports = extraTypings.exports;
var extraTypingsCommander = /*@__PURE__*/getDefaultExportFromCjs(extraTypingsExports);

// wrapper to provide named exports for ESM.
const {
  program,
  createCommand,
  createArgument,
  createOption,
  CommanderError,
  InvalidArgumentError,
  InvalidOptionArgumentError, // deprecated old name
  Command,
  Argument,
  Option,
  Help
} = extraTypingsCommander;

var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};
const CONFIG_PATH = "./circomkit.json";
function cli(args) {
  const circomkit = new index.Circomkit(fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) : {});
  const circuit = new Command("compile").description("compile the circuit").argument("<circuit>", "Circuit name").action((circuit2) => __async(this, null, function* () {
    const path = yield circomkit.compile(circuit2);
    circomkit.log.info("Built at:", path);
  }));
  const instantiate = new Command("instantiate").description("create the main component").argument("<circuit>", "Circuit name").action((circuit2) => __async(this, null, function* () {
    const path = circomkit.instantiate(circuit2);
    circomkit.log.info("Created at:", path);
  }));
  const info = new Command("info").description("print circuit information").argument("<circuit>", "Circuit name").action((circuit2) => __async(this, null, function* () {
    const info2 = yield circomkit.info(circuit2);
    console.log(`Prime Field: ${info2.primeName}`);
    console.log(`Number of Wires: ${info2.wires}`);
    console.log(`Number of Constraints: ${info2.constraints}`);
    console.log(`Number of Private Inputs: ${info2.privateInputs}`);
    console.log(`Number of Public Inputs: ${info2.publicInputs}`);
    console.log(`Number of Public Outputs: ${info2.publicOutputs}`);
    console.log(`Number of Labels: ${info2.labels}`);
  }));
  const clear = new Command("clear").description("clear circuit build artifacts").argument("<circuit>", "Circuit name").action((circuit2) => __async(this, null, function* () {
    yield circomkit.clear(circuit2);
    circomkit.log.info("Cleaned.");
  }));
  const init = new Command("init").description("initialize a new Circomkit project").argument("[dir]", "Directory").action((dir) => __async(this, null, function* () {
    const cmd = `git clone https://github.com/erhant/circomkit-examples.git ${dir != null ? dir : "."}`;
    circomkit.log.info(cmd);
    const result = yield new Promise(
      (resolve, reject) => child_process.exec(cmd, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr }))
    );
    circomkit.log.info(result.stdout);
    if (result.stderr) {
      circomkit.log.info(result.stderr);
    }
    circomkit.log.info("Circomkit project initialized! \u2728");
  }));
  const json = new Command("json").description("export JSON files").addCommand(
    new Command("r1cs").description("export r1cs").argument("<circuit>", "Circuit name").action((circuit2) => __async(this, null, function* () {
      const { json: json2, path } = yield circomkit.json("r1cs", circuit2);
      fs.writeFileSync(path, index.prettyStringify(json2));
      circomkit.log.info("Exported R1CS at: " + path);
    }))
  ).addCommand(
    new Command("zkey").description("export prover key").argument("<circuit>", "Circuit name").action((circuit2) => __async(this, null, function* () {
      const { json: json2, path } = yield circomkit.json("zkey", circuit2);
      fs.writeFileSync(path, index.prettyStringify(json2));
      circomkit.log.info("Exported prover key at: " + path);
    }))
  ).addCommand(
    new Command("wtns").description("export witness").argument("<circuit>", "Circuit name").argument("<input>", "Input name").action((circuit2, input) => __async(this, null, function* () {
      const { json: json2, path } = yield circomkit.json("wtns", circuit2, input);
      fs.writeFileSync(path, index.prettyStringify(json2));
      circomkit.log.info("Exported prover key at: " + path);
    }))
  );
  const contract = new Command("contract").description("export Solidity verifier contract").argument("<circuit>", "Circuit name").action((circuit2) => __async(this, null, function* () {
    const path = yield circomkit.contract(circuit2);
    circomkit.log.info("Created at: " + path);
  }));
  const calldata = new Command("calldata").description("export calldata for a verifier contract").argument("<circuit>", "Circuit name").argument("<input>", "Input name").action((circuit2, input) => __async(this, null, function* () {
    const calldata2 = yield circomkit.calldata(circuit2, input);
    circomkit.log.info(calldata2);
  }));
  const vkey = new Command("vkey").description("extract verification key").argument("<circuit>", "Circuit name").argument("[pkeyPath]", "Prover key path").action((circuit2, pkeyPath) => __async(this, null, function* () {
    const path = yield circomkit.vkey(circuit2, pkeyPath);
    circomkit.log.info("Created at: " + path);
  }));
  const prove = new Command("prove").description("generate zk-proof").argument("<circuit>", "Circuit name").argument("<input>", "Input name").action((circuit2, input) => __async(this, null, function* () {
    const path = yield circomkit.prove(circuit2, input);
    circomkit.log.info("Generated at: " + path);
  }));
  const verify = new Command("verify").description("verify zk-proof").argument("<circuit>", "Circuit name").argument("<input>", "Input name").action((circuit2, input) => __async(this, null, function* () {
    const ok = yield circomkit.verify(circuit2, input);
    if (ok) {
      circomkit.log.info("Verification successful.");
    } else {
      circomkit.log.info("Verification failed!");
    }
  }));
  const witness = new Command("witness").description("compute witness").argument("<circuit>", "Circuit name").argument("<input>", "Input name").action((circuit2, input) => __async(this, null, function* () {
    const path = yield circomkit.witness(circuit2, input);
    circomkit.log.info("Witness created: " + path);
  }));
  const setup = new Command("setup").description("commence circuit-specific setup").argument("<circuit>", "Circuit name").argument("[ptauPath]", "Path to PTAU").action((circuit2, ptauPath) => __async(this, null, function* () {
    const { proverKeyPath, verifierKeyPath } = yield circomkit.setup(circuit2, ptauPath);
    circomkit.log.info("Prover key created: " + proverKeyPath);
    circomkit.log.info("Verifier key created: " + verifierKeyPath);
  }));
  const ptau = new Command("ptau").description("download PTAU file").argument("<circuit>", "Circuit name").action((circuit2) => __async(this, null, function* () {
    const path = yield circomkit.ptau(circuit2);
    circomkit.log.info("PTAU ready at: " + path);
  }));
  const list = new Command("list").description("list circuits & instances").action(() => __async(this, null, function* () {
    const templates = fs.readdirSync(circomkit.config.dirCircuits).filter((path) => path.endsWith(".circom")).map((path) => path.slice(0, -".circom".length));
    circomkit.log.info(
      `Template Files (${circomkit.config.dirCircuits}):
` + templates.map((c, i) => `  ${i + 1}. ${c}`).join("\n")
    );
    const circuits = circomkit.readCircuits();
    circomkit.log.info(
      `
Circuit Names (${circomkit.config.circuits}):
` + Object.keys(circuits).map((c, i) => `  ${i + 1}. ${c}`).join("\n")
    );
  }));
  const config = new Command("config").description("print configuration").action(() => circomkit.log.info(circomkit.config));
  new Command().name("circomkit").description("Circom testing & development toolkit").addCommand(init).addCommand(config).addCommand(list).addCommand(json).addCommand(circuit).addCommand(instantiate).addCommand(info).addCommand(clear).addCommand(contract).addCommand(vkey).addCommand(ptau).addCommand(setup).addCommand(prove).addCommand(witness).addCommand(verify).addCommand(calldata).parse(args);
}
cli(process.argv);

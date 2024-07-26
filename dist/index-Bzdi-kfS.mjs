import * as snarkjs from 'snarkjs';
import { wasm } from 'circom_tester';
import { createWriteStream, readFileSync, openSync, readSync, existsSync, mkdirSync, writeFileSync, rmSync, renameSync } from 'fs';
import { rm, readFile, writeFile } from 'fs/promises';
import { randomBytes } from 'crypto';
import loglevel from 'loglevel';
import { get } from 'https';
import { AssertionError } from 'node:assert';
import { exec } from 'child_process';

const PTAU_URL_BASE = "https://storage.googleapis.com/zkevm/ptau";
function getPtauName(n) {
  const p = Math.ceil(Math.log2(n));
  let id = "";
  if (p < 8) {
    id = "_08";
  } else if (p < 10) {
    id = `_0${p}`;
  } else if (p < 28) {
    id = `_${p}`;
  } else if (p === 28) {
    id = "";
  } else {
    throw new Error("No PTAU for that many constraints!");
  }
  return `powersOfTau28_hez_final${id}.ptau`;
}
function downloadPtau(ptauName, ptauDir) {
  const ptauPath = `${ptauDir}/${ptauName}`;
  const file = createWriteStream(ptauPath);
  return new Promise((resolve) => {
    get(`${PTAU_URL_BASE}/${ptauName}`, (response) => {
      response.pipe(file);
      file.on("finish", () => {
        file.close();
        resolve(ptauPath);
      });
    });
  });
}

var __async$4 = (__this, __arguments, generator) => {
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
class WitnessTester {
  constructor(circomWasmTester) {
    this.circomWasmTester = circomWasmTester;
  }
  /** Assert that constraints are valid for a given witness. */
  expectConstraintPass(witness) {
    return __async$4(this, null, function* () {
      return this.circomWasmTester.checkConstraints(witness);
    });
  }
  /**
   * Assert that constraints are NOT valid for a given witness.
   * This is useful to test if a fake witness (a witness from a
   * dishonest prover) can still be valid, which would indicate
   * that there are soundness errors in the circuit.
   */
  expectConstraintFail(witness) {
    return __async$4(this, null, function* () {
      yield this.expectConstraintPass(witness).then(
        () => {
          throw new AssertionError({ message: "Expected constraints to not match." });
        },
        (err) => {
          if (err.message !== "Constraint doesn't match") {
            throw new AssertionError({ message: err.message });
          }
        }
      );
    });
  }
  /** Compute witness given the input signals. */
  calculateWitness(input) {
    return __async$4(this, null, function* () {
      return this.circomWasmTester.calculateWitness(input, false);
    });
  }
  /** Returns the number of constraints. */
  getConstraintCount() {
    return __async$4(this, null, function* () {
      if (this.constraints === void 0) {
        yield this.loadConstraints();
      }
      const numConstraints = this.constraints.length;
      return numConstraints;
    });
  }
  /** Asserts that the circuit has enough constraints.
   *
   * By default, this function checks if there **at least** `expected` many constraints in the circuit.
   * If `exact` option is set to `true`, it will also check if the number of constraints is exactly equal to
   * the `expected` amount.
   *
   * If first check fails, it means the circuit is under-constrained. If the second check fails, it means
   * the circuit is over-constrained.
   */
  expectConstraintCount(expected, exact) {
    return __async$4(this, null, function* () {
      const count = yield this.getConstraintCount();
      if (count < expected) {
        throw new AssertionError({
          message: "Circuit is under-constrained",
          expected,
          actual: count
        });
      }
      if (exact && count !== expected) {
        throw new AssertionError({
          message: "Circuit is over-constrained",
          expected,
          actual: count
        });
      }
    });
  }
  /** Expect a witness computation to fail in the circuit.
   *
   * See [here](https://github.com/iden3/circom/blob/master/code_producers/src/wasm_elements/common/witness_calculator.js#L21)
   * for the list of errors that may occur during witness calculation.
   * Most of the time, you will be expecting an assertion error.
   *
   * @returns the error message.
   */
  expectFail(input) {
    return __async$4(this, null, function* () {
      return yield this.calculateWitness(input).then(
        () => {
          throw new AssertionError({
            message: "Expected witness calculation to fail."
          });
        },
        (err) => {
          const errorMessage = err.message;
          const isExpectedError = [
            "Error: Assert Failed.",
            // a constraint failure (most common)
            "Not enough values for input signal",
            // few inputs than expected for a signal
            "Too many values for input signal",
            // more inputs than expected for a signal
            "Not all inputs have been set."
            // few inputs than expected for many signals
          ].some((msg) => errorMessage.startsWith(msg));
          if (!isExpectedError)
            throw err;
          return errorMessage;
        }
      );
    });
  }
  /** Expect an input to pass assertions and match the output.
   *
   * If `output` is omitted, it will only check for constraints to pass.
   */
  expectPass(input, output) {
    return __async$4(this, null, function* () {
      const witness = yield this.calculateWitness(input);
      yield this.expectConstraintPass(witness);
      if (output) {
        yield this.assertOut(witness, output);
      }
    });
  }
  /**
   * Computes the witness.
   * This is a shorthand for calculating the witness and calling {@link readWitnessSignals} on the result.
   */
  compute(input, signals) {
    return __async$4(this, null, function* () {
      const witness = yield this.calculateWitness(input);
      yield this.expectConstraintPass(witness);
      return yield this.readWitnessSignals(witness, signals);
    });
  }
  /**
   * Override witness value to try and fake a proof. If the circuit has soundness problems (i.e.
   * some signals are not constrained correctly), then you may be able to create a fake witness by
   * overriding specific values, and pass the constraints check.
   *
   * The symbol names must be given in full form, not just as the signal is named in the circuit code. In
   * general a symbol name looks something like:
   *
   * - `main.signal`
   * - `main.component.signal`
   * - `main.component.signal[n][m]`
   *
   * You will likely call `expectConstraintPass` on the resulting fake witness to see if it can indeed fool
   * a verifier.
   * @see {@link expectConstraintPass}
   */
  editWitness(witness, symbolValues) {
    return __async$4(this, null, function* () {
      yield this.loadSymbols();
      const fakeWitness = witness.slice();
      for (const symbolName in symbolValues) {
        const symbolInfo = this.symbols[symbolName];
        if (symbolInfo === void 0) {
          throw new Error("Invalid symbol name: " + symbolName);
        }
        fakeWitness[symbolInfo.varIdx] = symbolValues[symbolName];
      }
      return fakeWitness;
    });
  }
  /** Read symbol values from a witness. */
  readWitness(witness, symbols) {
    return __async$4(this, null, function* () {
      yield this.loadSymbols();
      const ans = {};
      for (const symbolName of symbols) {
        const symbolInfo = this.symbols[symbolName];
        if (symbolInfo === void 0) {
          throw new Error("Invalid symbol name: " + symbolName);
        }
        ans[symbolName] = witness[symbolInfo.varIdx];
      }
      return ans;
    });
  }
  /**
   * Read signals from a witness.
   *
   * This is not the same as {@link readWitness} in the sense that the entire value represented by a signal
   * will be returned here. For example, instead of reading `main.out[0], main.out[1], main.out[2]` with `readWitness`,
   * you can simply query `out` in this function and an object with `{out: [...]}` will be returned.
   *
   * To read signals within a component, simply refer to them as `component.signal`. In other words, omit the `main.` prefix
   * and array dimensions.
   */
  readWitnessSignals(witness, signals) {
    return __async$4(this, null, function* () {
      yield this.loadSymbols();
      const entries = [];
      function dotCount(s) {
        return s.split(".").length;
      }
      for (const signal of signals) {
        const signalDotCount = dotCount(signal) + 1;
        const signalLength = signal.length + 5;
        const symbolNames = Object.keys(this.symbols).filter((s) => signalDotCount === dotCount(s));
        const matchedSymbols = symbolNames.filter((s) => {
          const i = s.indexOf("[");
          if (i === -1) {
            return s.length === signalLength;
          } else {
            return s.slice(0, i).length === signalLength;
          }
        });
        if (matchedSymbols.length === 0) {
          throw new Error("No symbols matched for signal: " + signal);
        } else if (matchedSymbols.length === 1) {
          entries.push([signal, witness[this.symbols[matchedSymbols[0]].varIdx]]);
        } else {
          let processDepth2 = function(d) {
            const acc = [];
            if (d === dims.length - 1) {
              for (let i = 0; i < dims[d]; i++) {
                acc.push(witness[idx++]);
              }
            } else {
              for (let i = 0; i < dims[d]; i++) {
                acc.push(processDepth2(d + 1));
              }
            }
            return acc;
          };
          let idx = this.symbols[matchedSymbols[0]].varIdx;
          const splits = matchedSymbols.at(-1).split("[");
          const dims = splits.slice(1).map((dim) => parseInt(dim.slice(0, -1)) + 1);
          entries.push([signal, processDepth2(0)]);
        }
      }
      return Object.fromEntries(entries);
    });
  }
  /**
   * Assert the output of a given witness.
   * @param actualOut expected witness
   * @param expectedOut computed output signals
   */
  assertOut(actualOut, expectedOut) {
    return this.circomWasmTester.assertOut(actualOut, expectedOut);
  }
  /** Loads the list of R1CS constraints to `this.constraints`. */
  loadConstraints() {
    return __async$4(this, null, function* () {
      yield this.circomWasmTester.loadConstraints();
      this.constraints = this.circomWasmTester.constraints;
    });
  }
  /**
   * Loads the symbols in a dictionary at `this.symbols`
   * Symbols are stored under the .sym file
   *
   * Each line has 4 comma-separated values:
   *
   * 1.  symbol name
   * 2.  label index
   * 3.  variable index
   * 4.  component index
   */
  loadSymbols() {
    return __async$4(this, null, function* () {
      yield this.circomWasmTester.loadSymbols();
      this.symbols = this.circomWasmTester.symbols;
    });
  }
  /**
   * @deprecated this is buggy right now
   * @param witness witness
   */
  getDecoratedOutput(witness) {
    return this.circomWasmTester.getDecoratedOutput(witness);
  }
  /**
   * Cleanup directory, should probably be called upon test completion (?)
   * @deprecated this is buggy right now
   */
  release() {
    return this.circomWasmTester.release();
  }
}

var __async$3 = (__this, __arguments, generator) => {
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
class ProofTester {
  constructor(wasmPath, pkeyPath, vkeyPath, protocol) {
    this.wasmPath = wasmPath;
    this.pkeyPath = pkeyPath;
    this.vkeyPath = vkeyPath;
    this.protocol = protocol;
    this.verificationKey = JSON.parse(readFileSync(vkeyPath).toString());
    if (this.verificationKey.protocol !== protocol) {
      throw new Error("Protocol mismatch.");
    }
  }
  prove(input) {
    return __async$3(this, null, function* () {
      return snarkjs[this.protocol].fullProve(input, this.wasmPath, this.pkeyPath, void 0);
    });
  }
  verify(proof, publicSignals) {
    return __async$3(this, null, function* () {
      return yield snarkjs[this.protocol].verify(
        this.verificationKey,
        publicSignals,
        proof
      );
    });
  }
  expectPass(proof, publicSignals) {
    return __async$3(this, null, function* () {
      const ok = yield this.verify(proof, publicSignals);
      if (!ok) {
        throw new AssertionError({
          message: "Expected proof to be verified.",
          expected: true,
          actual: false
        });
      }
    });
  }
  expectFail(proof, publicSignals) {
    return __async$3(this, null, function* () {
      const ok = yield this.verify(proof, publicSignals);
      if (ok) {
        throw new AssertionError({
          message: "Expected proof to be not verified.",
          expected: false,
          actual: true
        });
      }
    });
  }
}

({
  bn128: BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617"),
  bls12381: BigInt("52435875175126190479447740508185965837690552500527637822603658699938581184513"),
  goldilocks: BigInt("18446744069414584321"),
  grumpkin: BigInt("21888242871839275222246405745257275088696311157297823662689037894645226208583"),
  pallas: BigInt("28948022309329048855892746252171976963363056481941560715954676764349967630337"),
  vesta: BigInt("28948022309329048855892746252171976963363056481941647379679742748393362948097"),
  secq256r1: BigInt("115792089210356248762697446949407573530086143415290314195533631308867097853951")
});
const primeToName = {
  "21888242871839275222246405745257275088548364400416034343698204186575808495617": "bn128",
  "0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001": "bn128",
  "52435875175126190479447740508185965837690552500527637822603658699938581184513": "bls12381",
  "0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001": "bls12381",
  "18446744069414584321": "goldilocks",
  "0xffffffff00000001": "goldilocks",
  "21888242871839275222246405745257275088696311157297823662689037894645226208583": "grumpkin",
  "0x30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47": "grumpkin",
  "28948022309329048855892746252171976963363056481941560715954676764349967630337": "pallas",
  "0x40000000000000000000000000000000224698fc094cf91b992d30ed00000001": "pallas",
  "28948022309329048855892746252171976963363056481941647379679742748393362948097": "vesta",
  "0x40000000000000000000000000000000224698fc0994a8dd8c46eb2100000001": "vesta",
  "115792089210356248762697446949407573530086143415290314195533631308867097853951": "secq256r1",
  "0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff": "secq256r1"
};
function prettyStringify(obj) {
  return JSON.stringify(obj, void 0, 2);
}

const PROTOCOLS = ["groth16", "plonk", "fflonk"];
const PRIMES = ["bn128", "bls12381", "goldilocks", "grumpkin", "pallas", "vesta", "secq256r1"];
const DEFAULT = Object.seal({
  // general settings
  protocol: "groth16",
  prime: "bn128",
  version: "2.1.0",
  // directories & paths
  circuits: "./circuits.json",
  dirPtau: "./ptau",
  dirCircuits: "./circuits",
  dirInputs: "./inputs",
  dirBuild: "./build",
  circomPath: "circom",
  // compiler-specific
  optimization: 1,
  inspect: true,
  include: ["./node_modules"],
  cWitness: false,
  // groth16 phase-2 settings
  groth16numContributions: 1,
  groth16askForEntropy: false,
  // solidity & calldata
  prettyCalldata: false,
  // logger
  logLevel: "INFO",
  verbose: true
});

var __async$2 = (__this, __arguments, generator) => {
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
function readR1CSInfo(r1csPath) {
  return __async$2(this, null, function* () {
    let pointer = 0;
    const r1csInfoType = {
      wires: 0,
      constraints: 0,
      privateInputs: 0,
      publicInputs: 0,
      publicOutputs: 0,
      useCustomGates: false,
      labels: 0,
      prime: BigInt(0),
      primeName: ""
    };
    const fd = openSync(r1csPath, "r");
    const numberOfSections = readBytesFromFile(fd, 0, 4, 8);
    pointer = 12;
    for (let i = Number(numberOfSections); i >= 0; i--) {
      const sectionType = Number(readBytesFromFile(fd, 0, 4, pointer));
      pointer += 4;
      const sectionSize = Number(readBytesFromFile(fd, 0, 8, pointer));
      pointer += 8;
      switch (sectionType) {
        case 1:
          pointer += 4;
          r1csInfoType.prime = readBytesFromFile(fd, 0, 32, pointer).toString();
          pointer += 32;
          r1csInfoType.wires = Number(readBytesFromFile(fd, 0, 4, pointer));
          pointer += 4;
          r1csInfoType.publicOutputs = Number(readBytesFromFile(fd, 0, 4, pointer));
          pointer += 4;
          r1csInfoType.publicInputs = Number(readBytesFromFile(fd, 0, 4, pointer));
          pointer += 4;
          r1csInfoType.privateInputs = Number(readBytesFromFile(fd, 0, 4, pointer));
          pointer += 4;
          r1csInfoType.labels = Number(readBytesFromFile(fd, 0, 8, pointer));
          pointer += 8;
          r1csInfoType.constraints = Number(readBytesFromFile(fd, 0, 4, pointer));
          pointer += 4;
          break;
        case 4:
          r1csInfoType.useCustomGates = Number(readBytesFromFile(fd, 0, 4, pointer)) > 0;
          pointer += Number(sectionSize);
          break;
        default:
          pointer += Number(sectionSize);
          break;
      }
    }
    r1csInfoType.primeName = primeToName[r1csInfoType.prime.toString()];
    return r1csInfoType;
  });
}
function readBytesFromFile(fd, offset, length, position) {
  const buffer = Buffer.alloc(length);
  readSync(fd, buffer, offset, length, position);
  return BigInt(`0x${buffer.reverse().toString("hex")}`);
}

var __defProp$1 = Object.defineProperty;
var __getOwnPropSymbols$1 = Object.getOwnPropertySymbols;
var __hasOwnProp$1 = Object.prototype.hasOwnProperty;
var __propIsEnum$1 = Object.prototype.propertyIsEnumerable;
var __defNormalProp$1 = (obj, key, value) => key in obj ? __defProp$1(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues$1 = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp$1.call(b, prop))
      __defNormalProp$1(a, prop, b[prop]);
  if (__getOwnPropSymbols$1)
    for (var prop of __getOwnPropSymbols$1(b)) {
      if (__propIsEnum$1.call(b, prop))
        __defNormalProp$1(a, prop, b[prop]);
    }
  return a;
};
var __async$1 = (__this, __arguments, generator) => {
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
function compileCircuit(config, targetPath, outDir) {
  return __async$1(this, null, function* () {
    mkdirSync(outDir, { recursive: true });
    let flags = `--sym --wasm --r1cs -p ${config.prime} -o ${outDir}`;
    if (config.include.length > 0)
      flags += " " + config.include.map((path) => `-l ${path}`).join(" ");
    if (config.verbose)
      flags += " --verbose";
    if (config.inspect)
      flags += " --inspect";
    if (config.cWitness)
      flags += " --c";
    if (config.optimization > 2) {
      flags += ` --O2round ${config.optimization}`;
    } else {
      flags += ` --O${config.optimization}`;
    }
    try {
      const result = yield new Promise((resolve, reject) => {
        exec(`${config.circomPath} ${flags} ${targetPath}`, (error, stdout, stderr) => {
          if (error === null) {
            resolve({ stdout, stderr });
          } else {
            reject(error);
          }
        });
      });
      return __spreadValues$1({}, result);
    } catch (e) {
      throw new Error("Compiler error:\n" + e);
    }
  });
}
function instantiateCircuit(config, targetDir, targetPath) {
  const circuitCode = makeCircuit(config);
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }
  writeFileSync(targetPath, circuitCode);
}
function makeCircuit(config) {
  const { version, file, pubs, template, params } = config;
  return `// auto-generated by circomkit
pragma circom ${version};

include "../${file}.circom";

component main${pubs.length === 0 ? "" : " {public[" + pubs.join(", ") + "]}"} = ${template}(${params.join(", ")});
`;
}

function getCalldata(proof, pubs, pretty = false) {
  const pubsCalldata = publicSignalsCalldata(pubs, pretty);
  let proofCalldata;
  switch (proof.protocol) {
    case "groth16":
      proofCalldata = groth16Calldata(proof, pretty);
      break;
    case "plonk":
      proofCalldata = plonkCalldata(proof, pretty);
      break;
    case "fflonk":
      proofCalldata = fflonkCalldata(proof, pretty);
      break;
    default:
      throw "Unknown protocol:" + proof.protocol;
  }
  return `
${proofCalldata}

${pubsCalldata}
`;
}
function publicSignalsCalldata(pubs, pretty) {
  const pubs256 = valuesToPaddedUint256s(pubs);
  if (pretty) {
    return `uint[${pubs.length}] memory pubs = [
    ${pubs256.join(",\n    ")}
];`;
  } else {
    return `[${pubs256.map((s) => `"${s}"`).join(",")}]`;
  }
}
function fflonkCalldata(proof, pretty) {
  const vals = valuesToPaddedUint256s([
    proof.polynomials.C1[0],
    proof.polynomials.C1[1],
    proof.polynomials.C2[0],
    proof.polynomials.C2[1],
    proof.polynomials.W1[0],
    proof.polynomials.W1[1],
    proof.polynomials.W2[0],
    proof.polynomials.W2[1],
    proof.evaluations.ql,
    proof.evaluations.qr,
    proof.evaluations.qm,
    proof.evaluations.qo,
    proof.evaluations.qc,
    proof.evaluations.s1,
    proof.evaluations.s2,
    proof.evaluations.s3,
    proof.evaluations.a,
    proof.evaluations.b,
    proof.evaluations.c,
    proof.evaluations.z,
    proof.evaluations.zw,
    proof.evaluations.t1w,
    proof.evaluations.t2w,
    proof.evaluations.inv
  ]);
  if (pretty) {
    return `uint256[24] memory proof = [
    ${vals.join(",\n    ")}
];`;
  } else {
    return `[${withQuotes(vals).join(",")}]`;
  }
}
function plonkCalldata(proof, pretty = false) {
  const vals = valuesToPaddedUint256s([
    proof.A[0],
    proof.A[1],
    proof.B[0],
    proof.B[1],
    proof.C[0],
    proof.C[1],
    proof.Z[0],
    proof.Z[1],
    proof.T1[0],
    proof.T1[1],
    proof.T2[0],
    proof.T2[1],
    proof.T3[0],
    proof.T3[1],
    proof.Wxi[0],
    proof.Wxi[1],
    proof.Wxiw[0],
    proof.Wxiw[1],
    proof.eval_a,
    proof.eval_b,
    proof.eval_c,
    proof.eval_s1,
    proof.eval_s2,
    proof.eval_zw
  ]);
  if (pretty) {
    return `uint[24] memory proof = [
    ${vals.join(",\n    ")}
];`;
  } else {
    return `[${withQuotes(vals).join(",")}]`;
  }
}
function groth16Calldata(proof, pretty) {
  const pA = valuesToPaddedUint256s([proof.pi_a[0], proof.pi_a[1]]);
  const pB0 = valuesToPaddedUint256s([proof.pi_b[0][1], proof.pi_b[0][0]]);
  const pB1 = valuesToPaddedUint256s([proof.pi_b[1][1], proof.pi_b[1][0]]);
  const pC = valuesToPaddedUint256s([proof.pi_c[0], proof.pi_c[1]]);
  if (pretty) {
    return [
      `uint[2] memory pA = [
  ${pA.join(",\n  ")}
];`,
      `uint[2][2] memory pB = [
  [
    ${pB0.join(",\n    ")}
  ],
  [
    ${pB1.join(",\n    ")}
  ]
];`,
      `uint[2] memory pC = [
  ${pC.join(",\n  ")}
];`
    ].join("\n");
  } else {
    return [
      `[${withQuotes(pA).join(", ")}]`,
      `[[${withQuotes(pB0).join(", ")}], [${withQuotes(pB1).join(", ")}]]`,
      `[${withQuotes(pC).join(", ")}]`
    ].join("\n");
  }
}
function valuesToPaddedUint256s(values) {
  return values.map((hexStr) => {
    const ans = "0x" + BigInt(hexStr).toString(16).padStart(64, "0");
    if (ans.length !== 66)
      throw new Error("uint256 overflow: " + hexStr);
    return ans;
  });
}
function withQuotes(vals) {
  return vals.map((val) => `"${val}"`);
}

class CircomkitPath {
  constructor(config) {
    this.config = config;
  }
  /**
   * Computes a path that requires a circuit name.
   *
   * @param circuit The name of the circuit.
   * @param kind The kind of file to compute the path for.
   */
  ofCircuit(circuit, kind) {
    const dir = `${this.config.dirBuild}/${circuit}`;
    switch (kind) {
      case "dir":
        return dir;
      case "main":
        return `${this.config.dirCircuits}/main/${circuit}.circom`;
      case "r1cs":
        return `${dir}/${circuit}.r1cs`;
      case "sym":
        return `${dir}/${circuit}.sym`;
      case "wasm":
        return `${dir}/${circuit}_js/${circuit}.wasm`;
      case "pkey":
        return `${dir}/${this.config.protocol}_pkey.zkey`;
      case "vkey":
        return `${dir}/${this.config.protocol}_vkey.json`;
      case "sol":
        return `${dir}/${this.config.protocol}_verifier.sol`;
      default:
        throw new Error("Invalid kind: " + kind);
    }
  }
  /**
   * Computes a path that requires a circuit and an input name.
   *
   * @param circuit The name of the circuit.
   * @param input The name of the input.
   * @param kind The kind of file to compute the path for.
   */
  ofCircuitWithInput(circuit, input, kind) {
    const dir = `${this.config.dirBuild}/${circuit}/${input}`;
    switch (kind) {
      case "dir":
        return dir;
      case "wtns":
        return `${dir}/witness.wtns`;
      case "pubs":
        return `${dir}/public.json`;
      case "proof":
        return `${dir}/${this.config.protocol}_proof.json`;
      case "in":
        return `${this.config.dirInputs}/${circuit}/${input}.json`;
      default:
        throw new Error("Invalid type: " + kind);
    }
  }
  /**
   * Given a PTAU name, returns the relative path.
   *
   * @param ptauName The name of the PTAU file, e.g. `powersOfTau28_hez_final_08.ptau`.
   */
  ofPtau(ptauName) {
    return `${this.config.dirPtau}/${ptauName}`;
  }
  /**
   * Given a circuit & id name, returns the relative path of the phase-2 PTAU.
   *
   * This is used in particular by Groth16's circuit-specific setup phase.
   *
   * @param circuit The name of the circuit.
   * @param id The id of the zKey.
   */
  ofZkey(circuit, id) {
    return `${this.config.dirBuild}/${circuit}/${circuit}_${id}.zkey`;
  }
}

var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
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
class Circomkit {
  constructor(overrides = {}) {
    const config = __spreadValues(__spreadValues({}, DEFAULT), overrides);
    this.config = JSON.parse(JSON.stringify(config));
    this.log = loglevel.getLogger("Circomkit");
    this.log.setLevel(this.config.logLevel);
    this.snarkjsLogger = this.config.verbose ? this.log : void 0;
    if (!PRIMES.includes(this.config.prime)) {
      throw new Error("Invalid prime in configuration.");
    }
    if (!PROTOCOLS.includes(this.config.protocol)) {
      throw new Error("Invalid protocol in configuration.");
    }
    if (this.config.optimization < 0) {
      this.log.warn("Optimization level must be at least 0, setting it to 0.");
      this.config.optimization = 0;
    }
    if (this.config.protocol === "plonk" && this.config.optimization !== 1) {
      this.log.warn(
        "Optimization level for PLONK must be 1.\n",
        "See: https://docs.circom.io/circom-language/circom-insight/simplification/"
      );
      this.config.optimization = 1;
    }
    this.path = new CircomkitPath(this.config);
  }
  /** Returns the contents of `circuits.json`. */
  readCircuits() {
    return JSON.parse(readFileSync(this.config.circuits, "utf-8"));
  }
  /** Returns a single circuit config from `circuits.json`. */
  readCircuitConfig(circuit) {
    const circuits = this.readCircuits();
    if (!(circuit in circuits)) {
      throw new Error("No such circuit in " + this.config.circuits);
    }
    return circuits[circuit];
  }
  /** Clear build files and the `main` component of a circuit. */
  clear(circuit) {
    return __async(this, null, function* () {
      yield Promise.all([
        rm(this.path.ofCircuit(circuit, "dir"), { recursive: true, force: true }),
        rm(this.path.ofCircuit(circuit, "main"), { force: true })
      ]);
    });
  }
  /** Export a verification key (vKey) from a proving key (zKey). */
  vkey(circuit, pkeyPath) {
    return __async(this, null, function* () {
      const vkeyPath = this.path.ofCircuit(circuit, "vkey");
      if (pkeyPath === void 0) {
        pkeyPath = this.path.ofCircuit(circuit, "pkey");
      }
      if (!existsSync(pkeyPath)) {
        throw new Error("There must be a prover key for this circuit to extract a verification key.");
      }
      const vkey = yield snarkjs.zKey.exportVerificationKey(pkeyPath, this.snarkjsLogger);
      writeFileSync(vkeyPath, prettyStringify(vkey));
      return vkeyPath;
    });
  }
  /** Returns circuit information. */
  info(circuit) {
    return __async(this, null, function* () {
      return yield readR1CSInfo(this.path.ofCircuit(circuit, "r1cs"));
    });
  }
  /** Downloads the phase-1 setup PTAU file for a circuit based on it's number of constraints.
   *
   * The downloaded PTAU files can be seen at [SnarkJS docs](https://github.com/iden3/snarkjs#7-prepare-phase-2).
   * Note that this may take a while if the circuit is large and thus a larger PTAU is needed.
   *
   * This function only works when the used prime is `bn128`.
   *
   * @returns path of the downloaded PTAU file
   */
  ptau(circuit) {
    return __async(this, null, function* () {
      const { constraints } = yield this.info(circuit);
      const ptauName = getPtauName(constraints);
      const ptauPath = this.path.ofPtau(ptauName);
      if (existsSync(ptauPath)) {
        return ptauPath;
      } else {
        if (this.config.prime !== "bn128") {
          throw new Error("Auto-downloading PTAU only allowed for bn128 at the moment.");
        }
        mkdirSync(this.config.dirPtau, { recursive: true });
        this.log.info(`Downloading ${ptauName}, this may take a while.`);
        return yield downloadPtau(ptauName, this.config.dirPtau);
      }
    });
  }
  /** Compile the circuit.
   *
   * A circuit configuration can be passed optionally; if not, the
   * config will be read from `circuits.json` at the working directory.
   *
   * @returns path of the build directory
   */
  compile(circuit, config) {
    return __async(this, null, function* () {
      const targetPath = this.instantiate(circuit, config);
      this.log.debug("Main component created at: " + targetPath);
      const outDir = this.path.ofCircuit(circuit, "dir");
      const { stdout, stderr } = yield compileCircuit(this.config, targetPath, outDir);
      if (this.config.verbose) {
        this.log.info(stdout);
      }
      if (stderr) {
        this.log.error(stderr);
      }
      return outDir;
    });
  }
  /** Exports a solidity contract for the verifier.
   * @returns path of the exported Solidity contract
   */
  contract(circuit) {
    return __async(this, null, function* () {
      const pkey = this.path.ofCircuit(circuit, "pkey");
      const template = readFileSync(`./node_modules/snarkjs/templates/verifier_${this.config.protocol}.sol.ejs`, "utf-8");
      const contractCode = yield snarkjs.zKey.exportSolidityVerifier(
        pkey,
        { [this.config.protocol]: template },
        this.snarkjsLogger
      );
      const contractPath = this.path.ofCircuit(circuit, "sol");
      writeFileSync(contractPath, contractCode);
      return contractPath;
    });
  }
  /** Export calldata to call a Verifier contract.
   *
   * @returns calldata
   */
  calldata(circuit, input, pretty) {
    return __async(this, null, function* () {
      const pubs = JSON.parse(
        yield readFile(this.path.ofCircuitWithInput(circuit, input, "pubs"), "utf-8")
      );
      const proof = JSON.parse(
        yield readFile(this.path.ofCircuitWithInput(circuit, input, "proof"), "utf-8")
      );
      const res = getCalldata(proof, pubs, pretty != null ? pretty : this.config.prettyCalldata);
      return res;
    });
  }
  /** Instantiate the `main` component.
   *
   * If `circuitConfig` argument is omitted, this function will look for it at `circuits.json`
   * in the working directory, and throw an error if no entry is found for the circuit.
   *
   * When config is read from file, `dir` defaults to `main`, otherwise `dir` defaults to `test`.
   * This is done to make it so that when CLI is used circuits are created under `main`, and when
   * we use Circomkit programmatically (e.g. during testing) circuits are created under `test`
   * unless specified otherwise.
   *
   * @returns path of the created main component
   */
  instantiate(circuit, circuitConfig) {
    if (!circuitConfig) {
      const circuitConfigFile = this.readCircuitConfig(circuit);
      circuitConfig = __spreadProps(__spreadValues({}, circuitConfigFile), {
        dir: circuitConfigFile.dir || "main",
        version: circuitConfigFile.version || this.config.version
      });
    }
    if (typeof circuitConfig.template === "undefined") {
      return `${this.config.dirCircuits}/${circuit}.circom`;
    }
    const directory = circuitConfig.dir || "test";
    const filePrefixMatches = directory.match(/\//g);
    let file = circuitConfig.file;
    if (filePrefixMatches !== null) {
      file = "../".repeat(filePrefixMatches.length) + file;
    }
    const config = {
      file,
      template: circuitConfig.template,
      version: circuitConfig.version || "2.0.0",
      dir: directory,
      pubs: circuitConfig.pubs || [],
      params: circuitConfig.params || []
    };
    const targetDir = `${this.config.dirCircuits}/${directory}`;
    const targetPath = `${targetDir}/${circuit}.circom`;
    instantiateCircuit(config, targetDir, targetPath);
    return targetPath;
  }
  /** Generate a proof.
   *
   * If `data` is not passed, the input data will be read from `inputs/<circuit>/<input>.json`.
   *
   * @returns path of the directory where public signals and proof are created
   */
  prove(circuit, input, data) {
    return __async(this, null, function* () {
      const wasmPath = this.path.ofCircuit(circuit, "wasm");
      if (!existsSync(wasmPath)) {
        this.log.warn("WASM file does not exist, creating it now...");
        yield this.compile(circuit);
      }
      const pkeyPath = this.path.ofCircuit(circuit, "pkey");
      if (!existsSync(pkeyPath)) {
        this.log.warn("Prover key does not exist, creating it now...");
        yield this.setup(circuit);
      }
      const jsonInput = data != null ? data : JSON.parse(readFileSync(this.path.ofCircuitWithInput(circuit, input, "in"), "utf-8"));
      const { proof, publicSignals } = yield snarkjs[this.config.protocol].fullProve(
        jsonInput,
        wasmPath,
        pkeyPath,
        this.snarkjsLogger
      );
      const dir = this.path.ofCircuitWithInput(circuit, input, "dir");
      mkdirSync(dir, { recursive: true });
      yield Promise.all([
        writeFile(this.path.ofCircuitWithInput(circuit, input, "pubs"), prettyStringify(publicSignals)),
        writeFile(this.path.ofCircuitWithInput(circuit, input, "proof"), prettyStringify(proof))
      ]);
      return dir;
    });
  }
  /** Commence a circuit-specific setup.
   *
   * If `ptauPath` argument is omitted, this function will try to automatically download it.
   * See the {@link ptau} method for more information about this.
   *
   * @returns path of the verifier key and prover key
   */
  setup(circuit, ptauPath) {
    return __async(this, null, function* () {
      const r1csPath = this.path.ofCircuit(circuit, "r1cs");
      const pkeyPath = this.path.ofCircuit(circuit, "pkey");
      const vkeyPath = this.path.ofCircuit(circuit, "vkey");
      if (!existsSync(r1csPath)) {
        this.log.warn("R1CS does not exist, creating it now.");
        yield this.compile(circuit);
      }
      if (ptauPath === void 0) {
        this.log.info("No PTAU was provided, downloading it.");
        if (this.config.prime !== "bn128") {
          throw new Error("Can not download PTAU file when using a prime field other than bn128");
        }
        ptauPath = yield this.ptau(circuit);
      } else if (!existsSync(ptauPath)) {
        this.log.warn("PTAU path was given but no PTAU exists there, downloading it anyways.");
        ptauPath = yield this.ptau(circuit);
      }
      this.log.info("Beginning setup phase!");
      if (this.config.protocol === "groth16") {
        let curZkey = this.path.ofZkey(circuit, 0);
        yield snarkjs.zKey.newZKey(r1csPath, ptauPath, curZkey, this.snarkjsLogger);
        for (let contrib = 1; contrib <= this.config.groth16numContributions; contrib++) {
          const nextZkey = this.path.ofZkey(circuit, contrib);
          this.log.info(`Making contribution: ${contrib}`);
          yield snarkjs.zKey.contribute(
            curZkey,
            nextZkey,
            `${circuit}_${contrib}`,
            this.config.groth16askForEntropy ? void 0 : randomBytes(32),
            // entropy
            this.snarkjsLogger
          );
          rmSync(curZkey);
          curZkey = nextZkey;
        }
        renameSync(curZkey, pkeyPath);
      } else {
        yield snarkjs[this.config.protocol].setup(r1csPath, ptauPath, pkeyPath, this.snarkjsLogger);
      }
      const vkey = yield snarkjs.zKey.exportVerificationKey(pkeyPath, this.snarkjsLogger);
      writeFileSync(vkeyPath, prettyStringify(vkey));
      return { verifierKeyPath: vkeyPath, proverKeyPath: pkeyPath };
    });
  }
  /** Verify a proof for some public signals.
   * @returns `true` if verification is successful, `false` otherwise.
   */
  verify(circuit, input) {
    return __async(this, null, function* () {
      const [vkey, pubs, proof] = (yield Promise.all(
        [
          this.path.ofCircuit(circuit, "vkey"),
          this.path.ofCircuitWithInput(circuit, input, "pubs"),
          this.path.ofCircuitWithInput(circuit, input, "proof")
        ].map((path) => readFile(path, "utf-8"))
      )).map((content) => JSON.parse(content));
      return yield snarkjs[this.config.protocol].verify(vkey, pubs, proof, this.snarkjsLogger);
    });
  }
  /** Calculates the witness for the given circuit and input.
   *
   * If `data` is not passed, the input data will be read from `inputs/<circuit>/<input>.json`.
   *
   * @returns path of the created witness
   */
  witness(circuit, input, data) {
    return __async(this, null, function* () {
      const wasmPath = this.path.ofCircuit(circuit, "wasm");
      const wtnsPath = this.path.ofCircuitWithInput(circuit, input, "wtns");
      const outDir = this.path.ofCircuitWithInput(circuit, input, "dir");
      const jsonInput = data != null ? data : JSON.parse(readFileSync(this.path.ofCircuitWithInput(circuit, input, "in"), "utf-8"));
      mkdirSync(outDir, { recursive: true });
      yield snarkjs.wtns.calculate(jsonInput, wasmPath, wtnsPath);
      return wtnsPath;
    });
  }
  /** Exports a JSON input file for some circuit with the given object.
   *
   * This is useful for testing real circuits, or creating an input programmatically.
   * Overwrites an existing input.
   *
   * @returns path of the created input file
   */
  input(circuit, input, data) {
    const inputPath = this.path.ofCircuitWithInput(circuit, input, "in");
    if (existsSync(inputPath)) {
      this.log.warn("Input file exists already, overwriting it.");
    }
    writeFileSync(inputPath, prettyStringify(data));
    return inputPath;
  }
  json(type, circuit, input) {
    return __async(this, null, function* () {
      let json;
      let path;
      switch (type) {
        case "r1cs": {
          path = this.path.ofCircuit(circuit, "r1cs");
          json = yield snarkjs.r1cs.exportJson(path, void 0);
          break;
        }
        case "zkey": {
          if (this.config.protocol !== "groth16") {
            throw new Error("Exporting zKey to JSON is only supported for Groth16 at the moment.");
          }
          path = this.path.ofCircuit(circuit, "pkey");
          json = yield snarkjs.zKey.exportJson(path);
          break;
        }
        case "wtns": {
          if (!input)
            throw new Error("Expected input");
          path = this.path.ofCircuitWithInput(circuit, input, "wtns");
          json = yield snarkjs.wtns.exportJson(path);
          break;
        }
        default:
          throw new Error("Unknown export target: " + type);
      }
      return {
        json,
        path: path + ".json"
      };
    });
  }
  /** Compiles the circuit and returns a witness tester instance. */
  WitnessTester(circuit, circuitConfig) {
    return __async(this, null, function* () {
      var _a, _b;
      (_a = circuitConfig.dir) != null ? _a : circuitConfig.dir = "test";
      const targetPath = this.instantiate(circuit, circuitConfig);
      const circomWasmTester = yield wasm(targetPath, {
        output: void 0,
        // this makes tests to be created under /tmp
        prime: this.config.prime,
        verbose: this.config.verbose,
        O: Math.min(this.config.optimization, 1),
        // tester doesnt have O2
        json: false,
        include: this.config.include,
        wasm: true,
        sym: true,
        recompile: (_b = circuitConfig.recompile) != null ? _b : true
      });
      return new WitnessTester(circomWasmTester);
    });
  }
  /** Returns a proof tester. */
  ProofTester(circuit, protocol) {
    return __async(this, null, function* () {
      const wasmPath = this.path.ofCircuit(circuit, "wasm");
      const pkeyPath = this.path.ofCircuit(circuit, "pkey");
      const vkeyPath = this.path.ofCircuit(circuit, "vkey");
      const missingPaths = [wasmPath, pkeyPath, vkeyPath].filter((p) => !existsSync(p));
      if (missingPaths.length !== 0) {
        throw new Error("Missing files: " + missingPaths.join(", "));
      }
      return new ProofTester(wasmPath, pkeyPath, vkeyPath, protocol);
    });
  }
}

export { Circomkit as C, prettyStringify as p };

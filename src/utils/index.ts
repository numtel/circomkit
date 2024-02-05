import type {CircomkitConfig, CircuitConfig} from '../types/';

/** A mapping from prime names to prime value as supported by Circom's `-p` option. */
export const primes: Record<CircomkitConfig['prime'], bigint> = {
  bn128: 21888242871839275222246405745257275088548364400416034343698204186575808495617n,
  bls12381: 52435875175126190479447740508185965837690552500527637822603658699938581184513n,
  goldilocks: 18446744069414584321n,
  grumpkin: 21888242871839275222246405745257275088696311157297823662689037894645226208583n,
  pallas: 28948022309329048855892746252171976963363056481941560715954676764349967630337n,
  vesta: 28948022309329048855892746252171976963363056481941647379679742748393362948097n,
  secq256r1: 115792089210356248762697446949407573530086143415290314195533631308867097853951n,
} as const;

/** A mapping from prime (decimals) to prime name as supported by Circom's `-p` option. */
export const primeToName: Record<`${bigint}`, CircomkitConfig['prime']> = {
  '21888242871839275222246405745257275088548364400416034343698204186575808495617': 'bn128',
  '52435875175126190479447740508185965837690552500527637822603658699938581184513': 'bls12381',
  '18446744069414584321': 'goldilocks',
  '21888242871839275222246405745257275088696311157297823662689037894645226208583': 'grumpkin',
  '28948022309329048855892746252171976963363056481941560715954676764349967630337': 'pallas',
  '28948022309329048855892746252171976963363056481941647379679742748393362948097': 'vesta',
  '115792089210356248762697446949407573530086143415290314195533631308867097853951': 'secq256r1',
} as const;

/** JSON Stringify with a prettier format. */
export function prettyStringify(obj: unknown): string {
  return JSON.stringify(obj, undefined, 2);
}

export const usageString = `Usage:

  Compile the circuit.
  > compile circuit

  Create main component.
  > instantiate circuit
  
  Print circuit information.
  > info circuit

  Clean build artifacts & main component.
  > clean circuit

  Export Verification Key (vKey.json).
  > vkey circuit zKeyPath

  Export Solidity verifier.
  > contract circuit
  
  Export calldata for a verifier contract.
  > calldata circuit input

  Export JSON for a chosen file.
  > json r1cs circuit
  > json zkey circuit
  > json wtns circuit input

  Commence circuit-specific setup.
  > setup circuit
  > setup circuit ptau-path
  
  Download the PTAU file needed for the circuit.
  > ptau circuit

  Generate a proof.
  > prove circuit input 

  Verify a proof.
  > verify circuit input

  Generate a witness.
  > witness circuit input
  
  Initialize a Circomkit project.
  > init                # initializes in "circomkit-project" folder
  > init project-name   # initializes in <project-name> folder

  Print configurations to console.
  > config
` as string;

/** Circuit builder, kinda like `ejs.render`. **Be very careful when editing this file.** */
export function makeCircuit(config: Required<CircuitConfig>) {
  return `// auto-generated by circomkit
pragma circom ${config.version};

include "../${config.file}.circom";

component main${config.pubs.length === 0 ? '' : ' {public[' + config.pubs.join(', ') + ']}'} = ${
    config.template
  }(${config.params.join(', ')});
`;
}

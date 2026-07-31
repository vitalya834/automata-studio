# Automata taxonomy for Automata Studio

Automata Studio is a model-based testing platform. A graph is a view of a model;
it is not the model's semantics. Every imported or generated model must declare a
`modelKind` and a semantic profile before algorithms can be selected.

## 1. Finite acceptors

- **DFA** — deterministic finite automaton accepting a language.
- **NFA / ε-NFA** — nondeterministic acceptor, optionally with silent ε moves.
- **ω-automata** — Büchi and related acceptance over infinite words.

Acceptors answer whether a word belongs to a language. They do not by themselves
model the input/output reaction of a device.

## 2. Finite input/output machines

- **Mealy FSM** — output is attached to a transition.
- **Moore FSM** — output is attached to a state.
- **Deterministic / nondeterministic** — one or multiple reactions for
  `state + input`.
- **Complete / partial** — every input is or is not defined in every state.
- **Observable / non-observable** — whether `state + input + output` identifies
  the next state.
- **Connected, strongly connected, reduced/minimal** — independent structural
  properties that must be checked explicitly.

This is the primary core for W, Wp, H, HSI, transition cover, distinguishing,
homing and synchronizing experiments.

## 3. Extended FSM (EFSM)

EFSM adds typed variables, input/output parameters, guards and update actions.
A path in the graph is not necessarily feasible: test generation needs symbolic
execution and a constraint solver. Undefined operations, guard evaluation order,
domains and update order are part of the semantic profile.

## 4. Timed models

### 4.1 Timed FSM with input guards

An input transition is enabled only in a time interval after entering a state.
The Tomsk work often uses one clock reset on a transition and builds a finite FSM
abstraction by partitioning time domains.

### 4.2 Timed FSM with timeouts

If no input arrives for a configured duration, the machine changes state without
an external input. A timeout therefore describes waiting behaviour, not output
latency.

### 4.3 Timed FSM with output delays

After an input is accepted, the output appears after a delay. A transition can
have a constant, interval or a finitely represented set of delay functions.

### 4.4 Combined timeout + output-delay TFSM

The Tomsk composition work combines state timeouts and transition output delays.
Parallel composition can produce an infinite countable set of output delays even
when components use constants. Such sets can be represented by finite families
of linear functions `b + k·t`.

### 4.5 Alur–Dill timed automata

A timed automaton has finite control locations and non-negative real-valued
clocks. Locations have invariants; edges have clock guards and reset sets. Its
semantic state space is generally infinite even though the location graph is
finite. Delay transitions and action transitions are distinct.

### 4.6 Timed I/O and timed extended machines

Timed I/O automata classify actions as input/output/internal and support
composition. TEFSM combines clocks with EFSM data. These profiles need explicit
priority, urgency, tolerance and quiescence rules.

## 5. Interaction and concurrency models

- **I/O automata / IOLTS** — input, output and internal actions; ioco uses
  quiescence as an observable testing concept.
- **Communicating FSM (CFSM)** — local FSMs connected by asynchronous FIFO
  channels; relevant faults include deadlock, orphan messages, unspecified
  reception and unbounded queues.
- **Statecharts / SCXML / UML state machines** — hierarchy, orthogonal regions,
  history, events and run-to-completion semantics.

These models require scheduler, queue and event-order semantics. A plain directed
graph is insufficient.

## 6. Quantitative models

- **DTMC** — discrete-time Markov chain.
- **CTMC** — continuous-time Markov chain with rates.
- **MDP / probabilistic automaton** — nondeterministic action choice plus
  probability distributions.
- **PTA / POMDP / POPTA** — timed and partially observable variants.

Their oracle is statistical: one observed run cannot prove conformance. Tests
must record sample budget, confidence and scheduler assumptions.

## 7. Models outside the finite core

- **Pushdown automata** add a stack.
- **Hybrid automata** add continuous variables, flows and differential dynamics.
- CFSM with unbounded queues also becomes infinite-state.

They belong in advanced engines or bounded abstractions. W/Wp/H/HSI must never
be applied to them merely because their control graph looks finite.

## 8. Testing terminology

- **State/transition/n-switch coverage** — structural coverage only.
- **Transition cover** — paths reaching and traversing every reachable
  transition; it is not a complete conformance guarantee.
- **W, Wp, H, HSI** — complete fault-domain methods under stated assumptions.
- **UIO / distinguishing sequence** — identifies the initial state.
- **Homing sequence** — identifies the state reached after the experiment.
- **Synchronizing sequence** — drives every possible initial state to one known
  state.
- **Preset / adaptive** — fixed sequence versus next input selected from the
  observed reaction.
- **Mutation testing** — derive tests that kill target/output/guard/update/time
  mutants; equivalent mutants must be reported separately.
- **Oracle** — decides whether an observation is allowed: exact, set-valued,
  symbolic, timed or statistical.

## Primary references

- FSMTest: https://fsmtestonline.ru/
- TFSM with timeouts and output delays:
  https://doi.org/10.15514/ISPRAS-2017-29(3)-13
- Timed nondeterministic distinguishing experiments:
  https://acta.bibl.u-szeged.hu/32895/1/actacyb_21_2_2013_1.pdf
- Alur–Dill timed automata:
  https://doi.org/10.1016/0304-3975(94)90010-8
- UPPAAL semantics:
  https://docs.uppaal.org/language-reference/system-description/semantics/
- I/O automata: https://groups.csail.mit.edu/tds/papers/Lynch/tuttle.html
- ioco/model-based testing:
  https://www.microsoft.com/en-us/research/?p=183376
- Communicating FSM:
  https://doi.org/10.1145/322374.322380
- SCXML 1.0: https://www.w3.org/TR/scxml/
- UML 2.5.1: https://www.omg.org/spec/UML/2.5.1/
- PRISM probabilistic model types:
  https://www.prismmodelchecker.org/manual/ThePRISMLanguage/ModelType


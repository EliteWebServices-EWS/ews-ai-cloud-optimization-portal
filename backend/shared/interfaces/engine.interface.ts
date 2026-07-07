/**
 * Generic engine contract. All core engines implement this pattern.
 */
export interface Engine<Input, Output> {
  readonly name: string;
  execute(input: Input): Promise<Output>;
}

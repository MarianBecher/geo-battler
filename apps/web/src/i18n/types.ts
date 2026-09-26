/** A dictionary entry: a string with {placeholders} or a plural pair chosen by `n`. */
export type Message = string | { one: string; other: string };

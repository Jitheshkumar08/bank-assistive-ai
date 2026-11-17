import type { InterpreterClient } from '@/types/interpreter';
import { HttpInterpreterClient } from './httpInterpreterClient';

/** The interpreter implementation the app talks to. */
export const interpreterClient: InterpreterClient = new HttpInterpreterClient();

export { HttpInterpreterClient } from './httpInterpreterClient';

/** Chat output that is not conversation: startup banners, update notices, command confirmations. */

import { type Component, Container, Spacer } from "@hyzek/toucan-tui";

/**
 * Wraps a notice block as a single chat child. The block renders exactly like its unwrapped children
 * (a Container concatenates their lines), but the transcript check below can tell it apart.
 */
export class ChatNotice extends Container {}

/**
 * Whether the chat holds conversation the launch tip should yield to: any child that is neither a
 * notice block nor a blank spacer row. Prompts, model replies, `!` bash rows, tool rows and
 * built-in command output all count; startup and update notices do not.
 */
export function hasChatTranscript(children: readonly Component[]): boolean {
	return children.some((child) => !(child instanceof ChatNotice) && !(child instanceof Spacer));
}

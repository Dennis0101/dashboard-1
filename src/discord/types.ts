export type DiscordInteraction = any;

export const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3
} as const;

export const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5
} as const;

export const MessageFlags = {
  EPHEMERAL: 1 << 6
} as const;

export type InteractionResponse = {
  type: number;
  data?: any;
};

export function ephemeral(content: string, extra?: any): InteractionResponse {
  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content, flags: MessageFlags.EPHEMERAL, ...extra }
  };
}

export function publicMsg(content: string, extra?: any): InteractionResponse {
  return { type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, data: { content, ...extra } };
}


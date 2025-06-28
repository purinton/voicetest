// events/messageCreate.mjs
export default async function ({ client, log, msg }, message) {
    log.debug('messageCreate', { message });
    // Only respond if the bot is mentioned or the message is a reply to the bot
    const botId = client.user.id;
    const mentioned = message.mentions && message.mentions.users && message.mentions.users.has(botId);
    const isReplyToBot = message.reference && message.reference.messageId && message.channel && message.reference.author.id === botId;
    if (mentioned || isReplyToBot) {
        const text = message.content.replace(`<@${botId}>`, '').trim();
        if (client.sendOpenAIMessage && typeof client.sendOpenAIMessage === 'function') {
            client.sendOpenAIMessage(text);
            log.debug('Sent message to OpenAI WebSocket', { text });
        } else {
            log.error('sendOpenAIMessage not attached to client');
        }
    }
}

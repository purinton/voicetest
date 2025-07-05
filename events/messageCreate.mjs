// events/messageCreate.mjs
export default async function ({ client, log, msg }, message) {
    const botId = client.user.id;
    if (message.author.id === botId) return;
    const mentioned = message.mentions && message.mentions.users && message.mentions.users.has(botId);
    const isReplyToBot = message.reference && message.reference.messageId && message.channel && (await message.channel.messages.fetch(message.reference.messageId)).author.id === botId;
    if (mentioned || isReplyToBot) {
        const text = message.content.replace(`<@${botId}>`, '').trim();
        if (client.sendOpenAIMessage && typeof client.sendOpenAIMessage === 'function') {
            client.sendOpenAIMessage(text);
        } else {
            log.error('sendOpenAIMessage not attached to client');
        }
    }
}

// events/messageCreate.mjs
export default async function ({ client, log, msg }, message) {
    log.debug('messageCreate', { message });
}

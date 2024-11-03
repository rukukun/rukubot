import crypto from 'crypto'
import moment from 'moment'
import { JSONFilePreset } from 'lowdb/node';

const defaultData = { emotes: [], requests: [], bannedUsers: [] };
const db = await JSONFilePreset('db.json', defaultData);

export class database {
    static #defaultData = { emotes: [], requests: [], bannedUsers: [] };
    static #db;
    static #lifetime;

    /**
     * Initialize the databse
     * @param {int} lifetime How long emotes will remain active before they are removed by the bot
     */
    static async init(lifetime) {
        this.#db = await JSONFilePreset('db.json', this.#defaultData);
        this.#lifetime = lifetime;
    }

    /**
     * Generate and log a request in the database
     * @param {string} channel The channel the user posted in
     * @param {string} user The name of the user that posted the request
     * @param {string} message The message that was provided with the request
     */
    static async generateRequest(channel, user, message) {
        const newRequest = {
            id: crypto.randomUUID(),
            channel: channel,
            user: user,
            message: message
        }
        await this.#db.update(({ requests }) => requests.push(newRequest));
    }

    /**
     * Store an emote log in the database
     * @param {string} requester The username of the person that requested the emote
     * @param {string} emoteId The ID of the emote that was requested
     */
    static async writeDatabase(requester, emoteId, emoteSetId) {
        const expire = moment().add(this.#lifetime, "s");
        const newEntry = {
            id: crypto.randomUUID(),
            requester: requester,
            emoteId: emoteId,
            emoteSetId: emoteSetId,
            expire: expire.toDate()
        }
        console.log(newEntry);
        await this.#db.update(({ emotes }) => emotes.push(newEntry));
    }

    /**
     * @returns {Object} The next request in the queue
     */
    static getNextRequest() {
        return this.#db.data.requests.at(0);
    }

    /**
     * Returns true if user is currently banned
     * @param {string} user 
     * @returns {boolean}
     */
    static isBanned(user) {
        return this.#db.data.bannedUsers.includes(user)
    }

    /**
     * Adds the specified username to the ban list
     * @param {string} user 
     */
    static async banUser(user) {
        await this.#db.update(({ bannedUsers }) => bannedUsers.push(user));
    }

    /**
     * Removes the specified username from the ban list
     * @param {string} user 
     */
    static async unbanUnser(user) {
        this.#db.data.bannedUsers = this.#db.data.bannedUsers.filter((u) => u != user);
        this.#db.write();
    }

    /**
     * @returns True if the databse has any pending requests
     */
    static hasRequests() {
        return this.#db.data.requests.length > 0;
    }

    /**
     * Check if input datetime is expired
     * @param {*} expire 
     * @returns 
     */
    static isExpired(expire) {
        return moment().isSameOrAfter(moment(expire));
    }

    /**
     * @returns All expired entries
     */
    static async getExpiredEntries() {
        return await this.#db.data.emotes.filter((emote) => this.isExpired(emote.expire));
    }

    /**
     * Removes the specified emote IDs from the dabase
     * @param {string} expiredEmoteIds 
     */
    static async removeEmotesFromDb(expiredEmoteIds) {
        this.#db.data.emotes = this.#db.data.emotes.filter((emote) => !expiredEmoteIds.includes(emote.id))
        await this.#db.write();
    }

    /**
     * Gets the amount of emotes user currently has logged in the database.
     * @param {string} user 
     * @returns Amount of emotes currently in the databse from the given user
     */
    static async getUserEmoteCount(user) {
        var result = 0;
        this.#db.data.emotes.filter((emote) => emote.requester == user).forEach(() => result++);
        return result;
    }

    /**
     * Clears target request from the request queue
     * @param {Object} curRequest The request to be cleared form the queue
     */
    static async clearRequest(curRequest) {
        this.#db.data.requests = this.#db.data.requests.filter((request) => request.id != curRequest.id);
        await this.#db.write();
    }

    /**
     * Get all emotes requested by the target user
     * @param {string} user Get all emotes requested by the username
     * @returns {Array<Object>} A list of all emotes requested by user
     */
    static async getUserEmotes(user) {
        return this.#db.data.emotes.filter((emote) => emote.requester.toLowerCase() == user.toLowerCase())
    }

    /**
     * Removes all emotes from the databse by the target username
     * @param {string} user Target username
     */
    static async clearAllEmotesFromUser(user) {
        this.#db.data.emotes = this.#db.data.emotes.filter((emote) => emote.requester.toLowerCase() != user.toLowerCase());
        await this.#db.write();
    }
}

export default database;
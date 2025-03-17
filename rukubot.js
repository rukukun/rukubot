//Credit to https://github.com/melon095
//https://github.com/melon095/Fumobot/blob/main/Scripts/cron/SevenTVToken.sh

import tmi from 'tmi.js'
import config from 'config'
import axios from 'axios'

import seventv from './seventv.js'
import database from './database.js'

import 'dotenv/config'

//The name of the channel to interact with
const channelName = config.get('channel');

//The ID of the target point reward
const targetRewardId = config.get('rewardId');

//The SevenTV user ID of the target channel
const stvUserId = config.get('sevenTVUserId');

//Emote lifetime, how long emotes should remain active before getting removed
const emoteLifetime = config.get('emoteLifetime');

//Amount of active emotes per user at a time
const emotesPerUser = config.get('maxEmotesPerUser');

//The user ID of the broadcaster
const broadcasterUserId = config.get('broadcasterUserId');

//List of chat messages to be output by the bot
const messages = config.get("messages");

//Route to Twitch Redemptions API
const REDEMPTIONS_ROUTE = 'https://api.twitch.tv/helix/channel_points/custom_rewards/redemptions'

//modLock is used to lock the modification of the databases while requests are being processed
var modLock = false;

//Initialise the database
await database.init(emoteLifetime);

/**
 * Takes an input string and subtitutes placeholders for variables
 * @param {string} template The input string to be formatted
 * @param  {...any} args Arguments to be substituted
 * @returns {string} Formatted string with substitutes
 */
const formatString = (template, ...args) => {
    return template.replace(/{([0-9]+)}/g, function (match, index) {
        return typeof args[index] === 'undefined' ? match : args[index];
    });
}

/**
 * Handle a point reward redeem from given user, and add the target emote
 * @param {string} channel The target channel name
 * @param {string} user The username of the requestor
 * @param {string} message The input message of the redeem
 * @returns True if the emote was added/the request was handled successfully
 */
async function handleRedeem(channel, user, message) {
    var id = "";

    // Define a regular expression to match full or partial URLs
    const regex = /(?:https?:\/\/)?7tv\.app\/emotes\/([a-zA-Z0-9]+)/;

    // Check if the message matches the regex
    const match = message.match(regex);

    console.log(match)

    if (match) {
        id = match[1];
    } else {
        id = message;
    }

    var emoteSetId = await seventv.getEmoteSetId(stvUserId)
    if(emoteSetId == null)
    {
        say("Oops.. something went wrong.. (5)")
        return false;
    }

    var enableResponse = await seventv.enableEmote(id, emoteSetId);
    console.log(enableResponse);

    function say(msg) {
        client.say(channel, formatString(msg, enableResponse.id, enableResponse.name));
    }

    switch (enableResponse.code) {
        case 0:
            say(messages.emoteAdd_success);
            await database.writeDatabase(user, id, emoteSetId, enableResponse.name);
            console.log("Emote added");
            return true;
        case 1:
            say(messages.emoteAdd_notfound);
            break;
        case 2:
            say(messages.emoteAdd_private);
            break;
        case 3:
            say(messages.emoteAdd_present);
            break;
        case 4:
            say("Oops.. something went wrong.. (4)")
            break;
        case 10:
            say("Oops.. something went wrong.. (10)")
            break;
        case 11:
            say("Oops.. something went wrong.. (11)")
            break;
    }

    return false;
}

/**
 * Refund the target request
 * @param {Object} request 
 * @returns {boolean} True if refund was processed successfully
 */
async function handleRefund(request) {
    var lastRedeem = await getLastRedemption(request.user);
    if (lastRedeem && await setRedemptionStatus(lastRedeem, "CANCELED")) {
        console.log("Refunded user " + request.user);
        return true;
    } else {
        console.log("Could not handle refund");
        client.say(request.channel, `Failed to process refund for @${curRequest.user} `)
        return false;
    }
}

/**
 * Mark a target request as fulfilled on twitch
 * @param {Object} request Request to mark as fulfilled on twitch
 * @returns {boolean} True if the request was marked as fulfilled successfully
 */
async function fulfillRedemption(request) {
    var lastRedeem = await getLastRedemption(request.user);
    if (lastRedeem && await setRedemptionStatus(lastRedeem, "FULFILLED")) {
        console.log("Fulfilled redemption for user " + request.user);
        return true;
    } else {
        console.log("Could not fulfill redemption");
        client.say(request.channel, `Failed to fulfill redemption for @${request.user} `)
        return false;
    }
}

/**
 * Handle the next request in the request queue
 */
async function handleNextRequest() {
    if (modLock)
        return;
    modLock = true;

    

    if (database.hasRequests()) {
        var curRequest = database.getNextRequest();
        function say(msg) {
            client.say(curRequest.channel, formatString(msg, curRequest.user));
        }
        if (!database.isBanned(curRequest.user.toLowerCase())) {
            var curEmoteCount = await database.getUserEmoteCount(curRequest.user)
            console.log("User " + curRequest.user + " currently has " + curEmoteCount + " active emotes.")
            if (curEmoteCount >= emotesPerUser) {
                say(messages.request_present);
                await handleRefund(curRequest);
            } else {
                say(messages.request_accepted)
                const requestHandled = await handleRedeem(curRequest.channel, curRequest.user, curRequest.message);
                if (!requestHandled) {
                    await handleRefund(curRequest);
                } else {
                    await fulfillRedemption(curRequest);
                }
            }
        } else {
            say(messages.request_banned);
            await handleRefund(curRequest);
        }
        await database.clearRequest(curRequest);
    }
    modLock = false;
}

/**
 * Check for, remove and clear expired emotes from the database
 */
async function checkAndRemoveEmotes() {
    if (modLock)
        return;
    modLock = true;
    var expiredEmotes = await database.getExpiredEntries();
    if (expiredEmotes.length > 0) {
        var uuids = [];

        console.log("Disabling expired emotes..");
        for (const emote of expiredEmotes) {
            if (await seventv.disableEmote(emote.emoteId, emote.emoteSetId, emote.emoteName)) uuids.push(emote.id);
        }

        if (uuids.length > 0) {
            console.log("Remove emotes from local database..");
            database.removeEmotesFromDb(uuids);
        }
    }
    modLock = false;
}

/**
 * Processes a target message into a command and arguments
 * @param {string} message The message to be parsed
 * @returns {Object} Resulting command object
 */
function parseCommand(message) {
    // Regular expression to match "!command param1 param2 param3" format
    const regex = /^!(\w+)\s*(.*)/;

    // Check if the message matches the pattern
    const match = message.match(regex);

    if (match) {
        // "command" is in the first capture group
        const command = match[1];

        // "params" are in the second capture group, split by space
        const params = match[2].trim() ? match[2].trim().split(/\s+/) : [];

        return { command, params };
    } else {
        // If no match, return null
        return null;
    }
}

/**
 * Removes all emotes currently logged for a target user in the database
 * @param {string} user User to be purged
 * @returns {boolean} True if user emotes were removed successfully
 */
async function purgeUser(user) {
    var error = false;
    var userEmotes = await database.getUserEmotes(user);
    for (const emote of userEmotes) {
        var emoteSetId = await seventv.getEmoteSetId(stvUserId)
        if(emoteSetId == null)
        {
            console.log("Error disabling emotes.. Cannot get emote set.");
            return false;
        }
        if (!await seventv.disableEmote(emote.emoteId, emote.emoteSetId, emote.emoteName)) {
            error = true;
            break;
        }
    }
    if (!error) {
        await database.clearAllEmotesFromUser(user);
        return true;
    }

    return false;
}

/**
 * Removes all emote from database by target user
 * @param {string} user Username to be purged
 * @param {string} channel Target channel to reply to
 * @param {string} requestor The user that requested the purge
 */
async function tryPurgeUser(user, channel, requestor) {
    if (await purgeUser(user)) {
        client.say(channel, `@${requestor} removed all emotes requested by @${user}`)
    } else {
        client.say(channel, `@${requestor} error purging user.`)
    }
}

/**
 * Create a channel point redeem
 */
async function createReward() {
    var result = await axios.post("https://api.twitch.tv/helix/channel_points/custom_rewards",
        {
            title: "Add Emote",
            cost: 500
        }, {
        headers: {
            "Client-Id": process.env.TWITCH_BROADCASTER_CLIENTID,
            Authorization: `Bearer ${process.env.TWITCH_BROADCASTER_TOKEN}`
        },
        params: {
            broadcaster_id: broadcasterUserId
        }
    }
    )
}

/**
 * Changes the status of a target redemption on Twitch
 * @param {string} redemptionId The ID of the target redemption
 * @param {string} newStatus The new status of the redemption
 * @returns {boolean} If the status was changed successfully
 */
async function setRedemptionStatus(redemptionId, newStatus) {
    try {
        var refundResult = await axios.patch(REDEMPTIONS_ROUTE, {
            status: newStatus
        }, {
            headers: {
                "Client-Id": process.env.TWITCH_BROADCASTER_CLIENTID,
                Authorization: `Bearer ${process.env.TWITCH_BROADCASTER_TOKEN}`
            },
            params: {
                id: redemptionId,
                broadcaster_id: broadcasterUserId,
                reward_id: targetRewardId
            }
        });
        console.log(refundResult.data);
        return true;
    } catch (error) {
        console.log(error);
        return false;
    }
}

/**
 * Get the last redemption ID of target username
 * @param {string} user Target username
 * @returns {(string|null)} Returns the ID of the last redeem by the target user
 */
async function getLastRedemption(user) {
    try {
        var redemptionsResult = await axios.get(REDEMPTIONS_ROUTE, {
            headers: {
                "Client-Id": process.env.TWITCH_BROADCASTER_CLIENTID,
                Authorization: `Bearer ${process.env.TWITCH_BROADCASTER_TOKEN}`
            },
            params: {
                broadcaster_id: broadcasterUserId,
                reward_id: targetRewardId,
                status: "UNFULFILLED",
                sort: "NEWEST"
            }
        });
        if (!redemptionsResult.data || !redemptionsResult.data.data || !redemptionsResult.data.data[0]) {
            return null;
        }

        for (const entry of redemptionsResult.data.data) {
            if (entry.user_name.toLowerCase() != user.toLowerCase())
                continue;
            return entry.id;
        }

        return null;
    } catch (error) {
        console.log(error);
        return null;
    }
}

const client = new tmi.Client({
    connection: {
        reconnect: true
    },
    channels: [channelName],
    identity: {
        username: process.env.TWITCH_BOT_USERNAME,
        password: process.env.TWITCH_BOT_TOKEN
    }
});

await client.connect();

async function TestLogin()
{
    seventv.TestAuth();
}

client.on('message', (channel, context, message, self) => {
    const rewardId = context["custom-reward-id"]
    if (rewardId == targetRewardId) {
        database.generateRequest(channel, context["display-name"], message);
    } else if (context.mod || context.username == channelName) {
        const command = parseCommand(message);
        if (command) {
            if (command.command == "rb" || command.command == "rukubot") {
                try {
                    if (command.params[0] == "purge") {
                        console.log("Removing all emotes from user " + command.params[1]);
                        tryPurgeUser(command.params[1], channel, context["display-name"]);
                    } else if (command.params[0] == "ban") {
                        database.banUser(command.params[1].toLowerCase());
                        client.say(channel, `@${context["display-name"]} banned user @${command.params[1]}`)
                    } else if (command.params[0] == "unban") {
                        database.unbanUnser(command.params[1].toLowerCase());
                        client.say(channel, `@${context["display-name"]} unbanned user @${command.params[1]}`)
                    } else if (command.params[0] == "createdefaultreward") {
                        createReward()
                    }
                } catch (e) {
                    console.log("Exception " + e);
                }
            }
        }
    }
});

setInterval(handleNextRequest, 500);
setInterval(checkAndRemoveEmotes, 10000);
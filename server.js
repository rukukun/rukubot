//Credit to https://github.com/melon095
//https://github.com/melon095/Fumobot/blob/main/Scripts/cron/SevenTVToken.sh

import tmi from 'tmi.js'
import config from 'config'
import axios from 'axios'
import cookie from 'cookie'
import crypto from 'crypto'
import moment from 'moment'
import { JSONFilePreset } from 'lowdb/node';
import 'dotenv/config'

const channelName = config.get('channel');
const targetRewardId = config.get('rewardId');
const emoteSetid = config.get('emoteSetId');
const emoteLifetime = config.get('emoteLifetime');
const emotesPerUser = config.get('maxEmotesPerUser');
const broadcasterUserId = config.get('broadcasterUserId');
var bearerToken = "";

const AUTH_COOKIE_NAME = 'seventv-auth';
const CSRF_COOKIE_NAME = 'seventv-csrf';
const LOGIN_ROUTE = 'https://7tv.io/v3/auth?platform=twitch';
const GQL_ROUTE = 'https://7tv.io/v3/gql';
const CHECK_EMOTE_ROUTE = 'https://7tv.io/v3/emotes/';
const GET_EMOTE_SET_ROUTE = 'https://7tv.io/v3/emote-sets/'
const REDEMPTIONS_ROUTE = 'https://api.twitch.tv/helix/channel_points/custom_rewards/redemptions'
const TWITCH_USERS_ROUTE = 'https://api.twitch.tv/helix/users'

const defaultData = { emotes: [], requests: [], bannedUsers: [] };
const db = await JSONFilePreset('db.json', defaultData);

var modLock = false;

// Check if token is valid
async function checkAuth(token) {
    try {
        console.log("Checking for valid token..");
        const response = await axios.post(
            'https://7tv.io/v3/gql',
            { query: '{ user:actor{id} }' },
            { headers: { Authorization: `Bearer ${token}` } }
        );
        const userId = response.data?.data?.user?.id;
        console.log(response.data?.data);
        return userId && userId !== 'null';
    } catch (error) {
        console.log(error);
        return false;
    }
}

function getCookieValue(setCookieHeader, cookieName) {
    const cookies = setCookieHeader.map(cookieStr => cookie.parse(cookieStr));
    const foundCookie = cookies.find(c => c[cookieName]);
    return foundCookie ? foundCookie[cookieName] : null;
}

async function getAuth(token) {
    if (await checkAuth(token)) {
        console.log('Token is still valid');
        return token;
    }
    console.log('Generating new token');
    // Step 1: Initial login request
    const preStageOneResponse = await axios.get(LOGIN_ROUTE,
        {
            maxRedirects: 0,
            validateStatus: function (status) {
                return status == 302;
            }
        });
    const csrf = getCookieValue(preStageOneResponse.headers['set-cookie'], CSRF_COOKIE_NAME);

    // Step 2: Follow the Twitch login redirect
    const stageOneLocation = preStageOneResponse.headers['location'];
    const stageTwoResponse = await axios.get(stageOneLocation, {
        headers: { Cookie: `auth-token:${process.env.TWITCH_7TV_EDITOR_TOKEN};persistent=${process.env.TWITCH_7TV_EDITOR_PERSISTENT_COOKIE}` },
    });

    // Step 3: Parse and follow redirect URL
    var stageThreeUrl = stageTwoResponse.data.match(/URL='([^']+)'/)[1];
    stageThreeUrl = stageThreeUrl.replaceAll("&amp;", "&");

    const stageThreeResponse = await axios.get(stageThreeUrl, {
        headers: { Cookie: `${CSRF_COOKIE_NAME}=${csrf}` },
        maxRedirects: 0,
        validateStatus: function (status) {
            return status == 302;
        }
    });

    // Step 4: Get new authorization token
    const authCookie = getCookieValue(stageThreeResponse.headers['set-cookie'], AUTH_COOKIE_NAME);

    if (!authCookie) {
        console.error('Failed to get cookie');
        return;
    }

    console.log('New Bearer Token:', authCookie);

    // Optionally check the new token
    if (await checkAuth(authCookie)) {
        console.log('Token successfully updated');
    } else {
        console.error('Failed to verify new token');
    }
    return authCookie;
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

client.connect();

var cachedEmoteSet;

async function getEmoteSet() {
    const emoteSet = await axios.get(`${GET_EMOTE_SET_ROUTE}${emoteSetid}`).catch(function (error) {
        console.log(error);
    });
    cachedEmoteSet = emoteSet.data;
    return emoteSet.data;
}

function searchEmoteSetId(id) {
    var result = {}

    if (!cachedEmoteSet.hasOwnProperty("emotes")) {
        result.code = 0;
        return result;
    }

    for (let i = 0; i < cachedEmoteSet.emotes.length; i++) {
        if (cachedEmoteSet.emotes[i].id == id) {
            result.code = 1;
            result.emote = cachedEmoteSet.emotes[i];
            break;
        }
    }
    if (result.code == 1)
        return result;
    result.code = 0;
    return result;
}

function searchEmoteSetName(name) {
    if (!cachedEmoteSet.hasOwnProperty("emotes")) {
        return false;
    }

    for (let i = 0; i < cachedEmoteSet.emotes.length; i++) {
        if (cachedEmoteSet.emotes[i].name.toLowerCase() == name.toLowerCase()) {
            return true;
        }
    }
    return false;
}

async function sendEmoteQuery(id, action, name) {
    const emoteModifyTest = await axios.post(GQL_ROUTE, {
        operationName: "ChangeEmoteInSet",
        query: "mutation ChangeEmoteInSet($id: ObjectID!, $action: ListItemAction!, $emote_id: ObjectID!, $name: String) {\n  emoteSet(id: $id) {\n    id\n    emotes(id: $emote_id, action: $action, name: $name) {\n      id\n      name\n      __typename\n    }\n    __typename\n  }\n}",
        variables: {
            action: action,
            id: emoteSetid,
            emote_id: id,
            name: name
        }
    }, {
        headers: {
            authorization: `Bearer ${bearerToken}`,
            cookie: `seventv-auth=${bearerToken}`
        }
    })
        .catch(function (error) {
            console.log(error);
        });
}

async function checkEmote(id) {
    var result = {}
    const checkEmoteResponse = await axios.get(`${CHECK_EMOTE_ROUTE}${id}`,
        {
            validateStatus: function (status) {
                return status == 400 || status == 404 || status == 200 || status == 304;
            }
        }
    ).catch(function (error) {
        console.log(error);
    });

    if (checkEmoteResponse.status == 400 || checkEmoteResponse.status == 404) {
        result.code = 1;
        return result;
    }

    if (checkEmoteResponse.data.listed == false) {
        result.code = 2;
        return result;
    }

    result.code = 0;
    result.name = checkEmoteResponse.data.name;
    return result;
}

async function enableEmote(id) {
    var result = {};

    console.log("Getting bearer token..")
    bearerToken = await getAuth(bearerToken);

    console.log("Get emote set..");
    await getEmoteSet();

    console.log("Check if emote exists..");
    var emoteExists = await checkEmote(id);
    console.log(emoteExists);
    if (emoteExists.code == 1) {
        result.code = 1;
        result.msg = "I couldn't find the emote " + id + " modCheck ";
        return result;
    }

    if (emoteExists.code == 2) {
        result.code = 2;
        result.msg = "The emote with id " + id + " is not public FeelsCringeManW ";
        return result;
    }

    var emoteSearchResult = searchEmoteSetId(id);
    if (emoteSearchResult.code == 1) {
        result.code = 3;
        //result.msg = "We already have " + emoteSearchResult.emote.name + " " + emoteSearchResult.emote.data.name + ", its called \"" + emoteSearchResult.emote.name + "\" Pepega ";
        result.msg = emoteSearchResult.emote.name + " is called \"" + emoteSearchResult.emote.name + "\" here Pepega ";
        return result;
    }

    var desiredEmoteName = emoteExists.name;
    var mod = 2;
    while (searchEmoteSetName(desiredEmoteName)) {
        desiredEmoteName = emoteExists.name + mod;
    }

    await sendEmoteQuery(id, "ADD", desiredEmoteName);
    result.code = 0;
    //result.msg = "Added emote \"" + desiredEmoteName + "\" " + desiredEmoteName;
    result.msg = " " + desiredEmoteName + " ";
    return result;
}


async function disableEmote(id) {
    var result = {};

    var emoteExists = await checkEmote(id);

    /*var emoteSearchResult = searchEmoteSetId(id);
    if (emoteSearchResult.code == 0) {
        result.code = 1;
        result.msg = "Could not find emote with id " + id + " in emote set.";
        return result;
    }*/

    await sendEmoteQuery(id, "REMOVE", emoteExists.name);
    result.code = 0;
    result.msg = "Removed emote \"" + emoteExists.name + " with id " + id;
    return result;
}

async function handleRedeem(channel, user, message) {
    //62f91facc9f98235d55b349f
    var id = "";

    // Define a regular expression to match full or partial URLs
    const regex = /7tv\.app\/emotes\/([a-f0-9]{24})/;

    // Check if the message matches the regex
    const match = message.match(regex);

    if (match) {
        id = match[1];
    } else {
        id = message;
    }

    var enableResponse = await enableEmote(id);
    console.log(enableResponse);
    if (enableResponse.code == 0) {
        client.say(channel, enableResponse.msg)
        writeDatabase(user, id);
        console.log("Emote added");
        return true;
    }
    else if (enableResponse.code == 1 || enableResponse.code == 2 || enableResponse.code == 3) {
        client.say(channel, enableResponse.msg)
        return false;
    }
}

async function handleRefund(request) {
    var lastRedeem = await getLastRedemption(request.user);
    await setRedemptionStatus(lastRedeem.id, "CANCELED");
    console.log("Refunded user " + request.user);
}

async function fulfillRedemption(request) {
    var lastRedeem = await getLastRedemption(request.user);
    await setRedemptionStatus(lastRedeem.id, "FULFILLED");
    console.log("Fulfilled redemption for user " + request.user);
}

async function generateRequest(channel, user, message) {
    const newRequest = {
        id: crypto.randomUUID(),
        channel: channel,
        user: user,
        message: message
    }
    await db.update(({ requests }) => requests.push(newRequest));
}

async function writeDatabase(requester, emoteId) {
    const expire = moment().add(emoteLifetime, "s");
    const newEntry = {
        id: crypto.randomUUID(),
        requester: requester,
        emoteId: emoteId,
        expire: expire.toDate()
    }
    console.log(newEntry);
    await db.update(({ emotes }) => emotes.push(newEntry));
}

function isExpired(expire) {
    return moment().isSameOrAfter(moment(expire));
}

async function getExpiredEntries() {
    return await db.data.emotes.filter((emote) => isExpired(emote.expire));
}

async function removeEmotesFromDb(expiredEmoteIds) {
    db.data.emotes = db.data.emotes.filter((emote) => !expiredEmoteIds.includes(emote.id))
    await db.write();
}

async function getUserEmoteCount(user) {
    var result = 0;
    db.data.emotes.filter((emote) => emote.requester == user).forEach(() => result++);
    return result;
}

async function handleNextRequest() {
    if (modLock)
        return;
    modLock = true;
    if (db.data.requests.length > 0) {
        var curRequest = db.data.requests.at(0);

        if (!db.data.bannedUsers.includes(curRequest.user.toLowerCase())) {
            var curEmoteCount = await getUserEmoteCount(curRequest.user)
            console.log("User " + curRequest.user + " currently has " + curEmoteCount + " active emotes.")
            if (curEmoteCount >= emotesPerUser) {
                client.say(curRequest.channel, `You already added an emote @${curRequest.user} pepeReload `)
                await handleRefund(curRequest);
            } else {
                client.say(curRequest.channel, `HACKERMANS beep boop @${curRequest.user}`)
                const requestHandled = await handleRedeem(curRequest.channel, curRequest.user, curRequest.message);
                if (!requestHandled) {
                    await handleRefund(curRequest);
                } else {
                    await fulfillRedemption(curRequest);
                }
            }
        } else {
            client.say(curRequest.channel, `You are banned from requesting emotes @${curRequest.user} PepeLoser `)
            await handleRefund(curRequest);
        }

        db.data.requests = db.data.requests.filter((request) => request.id != curRequest.id);
        await db.write();
    }
    modLock = false;
}

async function checkAndRemoveEmotes() {
    if (modLock)
        return;
    modLock = true;
    var expiredEmotes = await getExpiredEntries();
    if (expiredEmotes.length > 0) {
        var uuids = [];
        console.log("Getting bearer token..")
        bearerToken = await getAuth(bearerToken);

        console.log("Get emote set..");
        await getEmoteSet();

        console.log("Disabling expired emotes..");
        for (const emote of expiredEmotes) {
            const result = await disableEmote(emote.emoteId);
            if (result.code == 0)
                uuids.push(emote.id);
            console.log(result.msg);
        }

        if (uuids.length > 0) {
            console.log("Remove emotes from local database..");
            removeEmotesFromDb(uuids);
        }
    }
    modLock = false;
}

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

async function purgeUser(user) {
    console.log("Getting bearer token..")
    bearerToken = await getAuth(bearerToken);
    for (const emote of db.data.emotes.filter((emote) => emote.requester.toLowerCase() == user.toLowerCase())) {
        await sendEmoteQuery(emote.emoteId, "REMOVE", "");
    }
    db.data.emotes = db.data.emotes.filter((emote) => emote.requester.toLowerCase() != user.toLowerCase());
    await db.write();
}

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

async function setRedemptionStatus(redemptionId, newStatus) {
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
}

async function getLastRedemption(user) {
    var result = {}
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
        result.code = 1;
        result.msg = "No redemptions found";
        return result;
    }

    for (const entry of redemptionsResult.data.data) {
        if (entry.user_name.toLowerCase() != user.toLowerCase())
            continue;
        result.id = entry.id;
        result.code = 0;
    }

    if (result.code != 0) {
        result.code = 2;
        result.msg = "No redemption found for " + user
        return result;
    }

    return result;
}

client.on('message', (channel, context, message, self) => {
    const rewardId = context["custom-reward-id"]
    if (rewardId == targetRewardId) {
        console.log(context);
        generateRequest(channel, context["display-name"], message);
    } else if (context.mod || context.username == channelName) {
        const command = parseCommand(message);
        if (command) {
            if (command.command == "rb" || command.command == "rukubot") {
                try {
                    if (command.params[0] == "purge") {
                        console.log("removing all emotes from user " + command.params[1]);
                        purgeUser(command.params[1]);
                        client.say(channel, `@${context["display-name"]} removed all emotes requested by @${command.params[1]}`)
                    } else if (command.params[0] == "ban") {
                        db.update(({ bannedUsers }) => bannedUsers.push(command.params[1].toLowerCase()))
                        client.say(channel, `@${context["display-name"]} banned user @${command.params[1]}`)
                    } else if (command.params[0] == "unban") {
                        db.data.bannedUsers = db.data.bannedUsers.filter((user) => user != command.params[1].toLowerCase());
                        db.write();
                        client.say(channel, `@${context["display-name"]} unbanned user @${command.params[1]}`)
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
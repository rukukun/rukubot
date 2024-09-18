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
var bearerToken = "";

const AUTH_COOKIE_NAME = 'seventv-auth';
const CSRF_COOKIE_NAME = 'seventv-csrf';
const LOGIN_ROUTE = 'https://7tv.io/v3/auth?platform=twitch';
const GQL_ROUTE = 'https://7tv.io/v3/gql';
const CHECK_EMOTE_ROUTE = 'https://7tv.io/v3/emotes/';
const GET_EMOTE_SET_ROUTE = 'https://7tv.io/v3/emote-sets/'

const emoteDbDefaultData = { emotes: [] };
const requestDbDefaultData = { requests: [] };
const emoteDb = await JSONFilePreset('emotedb.json', emoteDbDefaultData);
const requestDb = await JSONFilePreset('requestdb.json', requestDbDefaultData);

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
                return status == 400 || status == 200 || status == 304;
            }
        }
    ).catch(function (error) {
        console.log(error);
    });

    if (checkEmoteResponse.status == 400) {
        result.code = 1;
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
        result.msg = "The emote with id " + id + " does not exist";
        return result;
    }

    var emoteSearchResult = searchEmoteSetId(id);
    if (emoteSearchResult.code == 1) {
        result.code = 2;
        result.msg = "We already have the emote " + emoteSearchResult.emote.name + " " + emoteSearchResult.emote.data.name + ", its called \"" + emoteSearchResult.emote.name + "\"";
        return result;
    }

    var desiredEmoteName = emoteExists.name;
    var mod = 2;
    while (searchEmoteSetName(desiredEmoteName)) {
        desiredEmoteName = emoteExists.name + mod;
    }

    await sendEmoteQuery(id, "ADD", desiredEmoteName);
    result.code = 0;
    result.msg = "Added emote \"" + desiredEmoteName + "\" " + desiredEmoteName;
    return result;
}


async function disableEmote(id) {
    var result = {};

    var emoteSearchResult = searchEmoteSetId(id);
    if (emoteSearchResult.code == 0) {
        result.code = 1;
        result.msg = "Could not find emote with id " + id + " in emote set.";
        return result;
    }

    await sendEmoteQuery(id, "REMOVE", emoteSearchResult.emote.data.name);
    result.code = 0;
    result.msg = "Removed emote \"" + emoteSearchResult.emote.data.name + " with id " + id;
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
    else if (enableResponse.code == 1 || enableResponse.code == 2) {
        client.say(channel, enableResponse.msg)
        return false;
    }
}

async function handleRefund(request) {

}

async function generateRequest(channel, user, message) {
    const newRequest = {
        id: crypto.randomUUID(),
        channel: channel,
        user: user,
        message: message
    }
    await requestDb.update(({ requests }) => requests.push(newRequest));
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
    await emoteDb.update(({ emotes }) => emotes.push(newEntry));
}

function isExpired(expire) {
    return moment().isSameOrAfter(moment(expire));
}

async function getExpiredEntries() {
    return await emoteDb.data.emotes.filter((emote) => isExpired(emote.expire));
}

async function removeEmotesFromDb(expiredEmoteIds) {
    emoteDb.data.emotes = emoteDb.data.emotes.filter((emote) => !expiredEmoteIds.includes(emote.id))
    await emoteDb.write();
}

async function getUserEmoteCount(user) {
    var result = 0;
    emoteDb.data.emotes.filter((emote) => emote.requester == user).forEach(() => result++);
    return result;
}

async function handleNextRequest() {
    if (modLock)
        return;
    modLock = true;
    if (requestDb.data.requests.length > 0) {
        var curRequest = requestDb.data.requests.at(0);

        var curEmoteCount = await getUserEmoteCount(curRequest.user)
        console.log("User " + curRequest.user + " currently has " + curEmoteCount + " active emotes.")
        if (curEmoteCount >= emotesPerUser) {
            client.say(curRequest.channel, `Sorry @${curRequest.user}, you cannot add any more emotes at this moment.`)
            await handleRefund(curRequest);
        } else {
            client.say(channel, `One moment while I look for this emote @${curRequest.user}`)
            const requestHandled = await handleRedeem(curRequest.channel, curRequest.user, curRequest.message);
            if (!requestHandled) {
                await handleRefund(curRequest);
            }
        }

        requestDb.data.requests = requestDb.data.requests.filter((request) => request.id != curRequest.id);
        await requestDb.write();
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

client.on('message', (channel, context, message, self) => {
    if (context.username != "therukukun")
        return;
    const rewardId = context["custom-reward-id"]
    if (rewardId == targetRewardId) {
        console.log(context);
        generateRequest(channel, context["display-name"], message);
    }
});

setInterval(handleNextRequest, 500);
setInterval(checkAndRemoveEmotes, 10000);
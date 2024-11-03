import cookie from 'cookie'
import axios from 'axios'

export class seventv {

    static #AUTH_COOKIE_NAME = 'seventv-auth';
    static #CSRF_COOKIE_NAME = 'seventv-csrf';
    static #LOGIN_ROUTE = 'https://7tv.io/v3/auth?platform=twitch';
    static #GQL_ROUTE = 'https://7tv.io/v3/gql';
    static #CHECK_EMOTE_ROUTE = 'https://7tv.io/v3/emotes/';
    static #GET_EMOTE_SET_ROUTE = 'https://7tv.io/v3/emote-sets/'
    static #GET_USER_ROUTE = 'https://7tv.io/v3/users/'

    // Cached 7TV bearer token
    static #bearerToken;

    //Cached 7TV emote set
    static #cachedEmoteSet;

    /**
     * Get the value of a given cookie
     * @param {string} setCookieHeader 
     * @param {string} cookieName 
     * @returns {(string|null)} The given cookiename if its found, otherwise null
     */
    static #getCookieValue(setCookieHeader, cookieName) {
        const cookies = setCookieHeader.map(cookieStr => cookie.parse(cookieStr));
        const foundCookie = cookies.find(c => c[cookieName]);
        return foundCookie ? foundCookie[cookieName] : null;
    }

    static async getEmoteSetId(userID)
    {
        try {
            const userData = await axios.get(`${this.#GET_USER_ROUTE}${userID}`).catch(function (error) {
                console.log(error);
            });
            return userData.data.connections[0].emote_set_id;
        } catch (error) {
            console.log(error);
            return null;
        }
    }

    /**
     * Validate the given 7TH auth token.
     * Credit to https://github.com/melon095
     * https://github.com/melon095/Fumobot/blob/main/Scripts/cron/SevenTVToken.sh
     * @param {string} token 
     * @returns {boolean} True if the token is valid, false if the token is invalid.
     */
    static async #checkAuth(token) {
        try {
            console.log("Checking for valid token..");
            const response = await axios.post(
                'https://7tv.io/v3/gql',
                { query: '{ user:actor{id} }' },
                { headers: { Authorization: `Bearer ${token}` } }
            ).catch(function (error) {
                console.log(error);
                return false;
            });
            const userId = response.data?.data?.user?.id;
            console.log(response.data?.data);
            return userId && userId !== 'null';
        } catch (error) {
            console.log(error);
            return false;
        }
    }

    /**
     * Get 7TV bearer token. If given token is invalid, generate a new token.
     * Credit to https://github.com/melon095
     * https://github.com/melon095/Fumobot/blob/main/Scripts/cron/SevenTVToken.sh
     * @param {string} token The token to check for validity
     * @returns {(string|null)} Valid bearer token or null
     */
    static async #getAuth(token) {
        try {
            if (await this.#checkAuth(token)) {
                console.log('Token is still valid');
                return token;
            }
            console.log('Generating new token');
            // Step 1: Initial login request
            const preStageOneResponse = await axios.get(this.#LOGIN_ROUTE,
                {
                    maxRedirects: 0,
                    validateStatus: function (status) {
                        return status == 302 || status == 303;
                    }
                });
            const csrf = this.#getCookieValue(preStageOneResponse.headers['set-cookie'], this.#CSRF_COOKIE_NAME);

            // Step 2: Follow the Twitch login redirect
            const stageOneLocation = preStageOneResponse.headers['location'];
            const stageTwoResponse = await axios.get(stageOneLocation, {
                headers: { Cookie: `auth-token:${process.env.TWITCH_7TV_EDITOR_TOKEN};persistent=${process.env.TWITCH_7TV_EDITOR_PERSISTENT_COOKIE}` },
            });

            // Step 3: Parse and follow redirect URL
            var stageThreeUrl = stageTwoResponse.data.match(/URL='([^']+)'/)[1];
            stageThreeUrl = stageThreeUrl.replaceAll("&amp;", "&");

            const stageThreeResponse = await axios.get(stageThreeUrl, {
                headers: { Cookie: `${this.#CSRF_COOKIE_NAME}=${csrf}` },
                maxRedirects: 0,
                validateStatus: function (status) {
                    return status == 302 || status == 303;
                }
            });

            // Step 4: Get new authorization token
            const authCookie = this.#getCookieValue(stageThreeResponse.headers['set-cookie'], this.#AUTH_COOKIE_NAME);

            if (!authCookie) {
                console.error('Failed to get cookie');
                return;
            }

            console.log('New Bearer Token:', authCookie);

            // Optionally check the new token
            if (await this.#checkAuth(authCookie)) {
                console.log('Token successfully updated');
                return authCookie;
            }

            console.error('Failed to verify new token');
            return null;
        } catch (error) {
            console.log(error);
            return null;
        }
    }
    /**
     * Get emote set with given id
     * @param {string} targetEmoteSetId ID of the emote set to retrieve
     * @returns {(Object|null)} The given emote set or null
     */
    static async #getEmoteSet(targetEmoteSetId) {
        try {
            const emoteSet = await axios.get(`${this.#GET_EMOTE_SET_ROUTE}${targetEmoteSetId}`).catch(function (error) {
                console.log(error);
            });
            return emoteSet.data;
        } catch (error) {
            console.log(error);
            return null;
        }
    }

    /**
     * A result for an emote search in an emote set.
     * @param {int} code 0: Emote does not exist, 1: Emote does exist
     * @param {Object} emote Data for the found emote or null
     * @param {string} msg 
     */
    static #searchEmoteResult(code, emote, msg) {
        return {
            code: code,
            emote: emote,
            msg: msg
        }
    }

    /**
     * Searches for given emote id in given emote set
     * @param {string} id The ID of the emote to search for
     * @param {Object} emoteSet The emote set to search in
     * @returns {searchEmoteResult}
     */
    static #searchEmoteSetId(id, emoteSet) {
        if (!emoteSet.hasOwnProperty("emotes")) {
            return this.#searchEmoteResult(0, null, "The given emote set doesn not contain any emotes");
        }

        for (let i = 0; i < emoteSet.emotes.length; i++) {
            if (emoteSet.emotes[i].id == id) {
                return this.#searchEmoteResult(1, emoteSet.emotes[i], "Given emote was found");
            }
        }

        return this.#searchEmoteResult(0, null, "The given emote set doesn not contain any emotes");
    }

    /**
     * Searches for given emote name in given emote set.
     * @param {string} name The name of the emote to search for
     * @param {Object} emoteSet The emote set to search in
     * @returns {boolean} True if emote with given name is found, otherwilse false
     */
    static #searchEmoteSetName(name, emoteSet) {
        if (!emoteSet.hasOwnProperty("emotes")) {
            return false;
        }

        for (let i = 0; i < emoteSet.emotes.length; i++) {
            if (emoteSet.emotes[i].name.toLowerCase() == name.toLowerCase()) {
                return true;
            }
        }
        return false;
    }

    /**|
     * Send a query to 7TV.
     * @param {string} token Valid 7TV bearer token
     * @param {string} targetEmoteSetId ID of the target emote set to modify
     * @param {string} id The ID of the emote to query
     * @param {("ADD"|"REMOVE")} action "ADD" to add an emote, "REMOVE" to remove an emote.
     * @param {string} name Name to provide for the query.
     * @returns {boolean} True if query sent successfully, otherwise false
     */
    static async #sendEmoteQuery(token, targetEmoteSetId, id, action, name) {
        const emoteModifyTest = await axios.post(this.#GQL_ROUTE, {
            operationName: "ChangeEmoteInSet",
            query: "mutation ChangeEmoteInSet($id: ObjectID!, $action: ListItemAction!, $emote_id: ObjectID!, $name: String) {\n  emoteSet(id: $id) {\n    id\n    emotes(id: $emote_id, action: $action, name: $name) {\n      id\n      name\n      __typename\n    }\n    __typename\n  }\n}",
            variables: {
                action: action,
                id: targetEmoteSetId,
                emote_id: id,
                name: name
            }
        }, {
            headers: {
                authorization: `Bearer ${token}`,
                cookie: `seventv-auth=${token}`
            }
        }).catch(function (error) {
            console.log(error.response.data.errors);
            return false;
        });
        if(!emoteModifyTest) return false;
        console.log(emoteModifyTest);
        return true;
    }

    /**
     * A result for an emote search query.
     * @param {int} code 0: The emote exists on 7TV and is listed, 1: The emote does not exist on 7TV, 2: The emote exists on 7TV but is NOT listed
     * @param {string} name Name of the found emote
     * @param {string} message 
     */
    static #checkEmoteResult(code, name, message) {
        return {
            code: code,
            name: name,
            message: message
        }
    }

    /**
     * Check if given emote id exists on 7TV.
     * @param {string} id Emote ID to check for
     * @returns {checkEmoteResult}
     */
    static async #checkEmote(id) {
        const checkEmoteResponse = await axios.get(`${this.#CHECK_EMOTE_ROUTE}${id}`,
            {
                validateStatus: function (status) {
                    return status == 400 || status == 404 || status == 200 || status == 304;
                }
            }
        ).catch(function (error) {
            console.log(error);
        });

        if (checkEmoteResponse.status == 400 || checkEmoteResponse.status == 404) {
            return this.#checkEmoteResult(1, null, "The given emote ID was not found on 7TV");
        }

        if (checkEmoteResponse.data.listed == false) {
            result.code = 2;
            return this.#checkEmoteResult(2, checkEmoteResponse.data.name, "The given emote ID is not listed");
        }

        return this.#checkEmoteResult(0, checkEmoteResponse.data.name, "The given emote ID was found and is listed");
    }

    /**
     * The result of a "enable emote" request
     * @param {int} code 0: Successfully added emote, 1: Could not find emote with given ID, 2: Emote with given ID is unlisted, 3: Emote with given ID already exists in set, 4: emote query failed, 10: Invalid bearer token, 11: Could not get emote set
     * @param {string} id The ID of the enable emote request
     * @param {string} name The name of the target emote
     */
    static #enableEmoteResult(code, msg, id, name) {
        return {
            code: code,
            msg: msg,
            id: id,
            name: name
        }
    }

    /**
     * Attempt to enable emote with the given ID
     * @param {string} id 
     * @returns {enableEmoteResult}
     */
    static async enableEmote(id, emoteSetid) {
        console.log("Getting bearer token..")
        this.#bearerToken = await this.#getAuth(this.#bearerToken);

        if (!this.#bearerToken) return this.#enableEmoteResult(10, "Invalid bearer token", id, null);

        console.log("Get emote set..");
        this.#cachedEmoteSet = await this.#getEmoteSet(emoteSetid);

        if (!this.#cachedEmoteSet) return this.#enableEmoteResult(11, "Could not get emote set", id, null);

        console.log("Check if emote exists..");
        var emoteExists = await this.#checkEmote(id);

        if (emoteExists.code == 1) return this.#enableEmoteResult(1, "Emote not found", id, null);
        else if (emoteExists.code == 2) return this.#enableEmoteResult(2, "Unlisted emote", id, null);

        var emoteSearchResult = this.#searchEmoteSetId(id, this.#cachedEmoteSet);
        if (emoteSearchResult.code == 1) return this.#enableEmoteResult(3, "Emote already exists", id, emoteSearchResult.emote.name);

        var desiredEmoteName = emoteExists.name;
        var mod = 2;
        while (this.#searchEmoteSetName(desiredEmoteName, this.#cachedEmoteSet)) {
            desiredEmoteName = emoteExists.name + mod;
        }

        if (!await this.#sendEmoteQuery(this.#bearerToken, emoteSetid, id, "ADD", desiredEmoteName)) return this.#enableEmoteResult(4, "Emote query failed.", id, desiredEmoteName);

        return this.#enableEmoteResult(0, "Emote added", id, desiredEmoteName)
    }


    /**
     * Remove emote with the given id from the given emote set
     * @param {string} id 
     * @param {string} emoteSetId 
     * @returns {boolean}
     */
    static async disableEmote(id, emoteSetId) {
        console.log("Getting bearer token..")
        this.#bearerToken = await this.#getAuth(this.#bearerToken);

        if (!this.#bearerToken) {
            console.log("Invalid bearer token");
            return false;
        }

        if (!await this.#sendEmoteQuery(this.#bearerToken, emoteSetId, id, "REMOVE", "")) return false;

        console.log("Removed emote with id " + id);
        return true;
    }
}

export default seventv;
# RukuBot
RukuBot is a Twitch bot that processes a channel point redeem to add and automatically remove 7TV emotes. RukuBot will listen for a channel point reward and add the provided 7TV link to an emote set. After a set period of time, the emote will be removed.

RukuBot will automatically perform checks and refund channel points if the request could not be fulfilled.

Credit to [melon095](https://github.com/melon095) for his work on [7TV bearer tokens](https://github.com/melon095/Fumobot/blob/main/Scripts/cron/SevenTVToken.sh).

## Configuration

RukuBot has several configuration options available to customize the behaviour of the bot. An example configuration file can be found here;

> ./config/example.default.json

*In your own deployment, rename this file to "default.json" and edit as needed.*

You will also need to configure a .env file to provide your login tokens. An example .env file can be found here;

> ./.env.default

*In your own deployment, rename this file to ".env" and edit as needed*

## Commands

The bot will listen to a couple commands;
* !rb purge \<user\> - remove all emotes currently active that were requested by the given username.
* !rb ban \<user\> - ban given username from requesting any more emotes.
* !rb unban \<user\> - unabn given username.
* !rb createdefaultreward - create a default channel point redeem. **This is required for the bot to function properly.**

## Setup

 1. Clone the repository to target directory
 2. Configure your `.env` and `./config/default.json` configuration files
 3. Run the command `!rb createdefaultreward`
 4. Insert the ID of the newly created reward into the config file
 5. Run the bot (Recommend using pm2) 
 `pm2 start rukubot.js`

### Issues
Please feel free to report any issues here on github.

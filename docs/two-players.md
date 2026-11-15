# Playing against another player

On `practice.html`, "Play against: Another player" is for two people sharing one phone. The same board and keypad are used, and the two of you take turns. When the game is finished, the result is emailed to both players.

## Adding a player

You type the other player's email address (their name is optional). The email is required: the game cannot start without a valid one, and it cannot be your own.

The name can also be added or changed during a game (since Nov 14, 2026): **Edit name** under the other player's score, or by their score in Board mode, asks for it. Without one, the name is made from their email address ("ashtrower@..." plays as "Ashtrower"). The new name is used at once on every device showing the game, called out, saved with the game and put in its email, and kept as "Their name" for the next game. Your own name gets a "2" added if typed for them. Once a game is over it can't be renamed: the record is already saved, and saved games are never changed. The first player is whoever is signed in, and their email is the one on the Google account. Names are used everywhere the bot's name would be, and if both are the same the second gets a "2".

Playing works as it does against the bot, with these differences:

- Each player enters their own darts, by board or keypad, and the turn passes to the other player after the third dart (or when Enter is pressed, if "Press Enter" is on). The status line says whose turn it is.
- Either player's last visit can be corrected: "Edit Alex's last visit" and "Edit Sam's last visit" are both shown, and correcting one leaves the other's darts as entered.
- Scores are announced for both, in the same voice (see `docs/bot-practice.md` for how the caller's energy changes with the score - that applies here too, just without the bot's lower pitch).
- Only your own darts, from any game type, go into "Yours" on the heat map. The second player's darts are not counted as "The bot's".

## What is saved and emailed

A finished (or abandoned) game is one document in `versusGames/{id}`: the two names and emails, the game, the averages, both players' darts (with landing points where they were tapped), and a visit-by-visit log. Rules are `validVersusGame` in `firestore.rules`: the owner reads, creates and deletes their own; nothing is ever updated by the app, and the first player's email must match the signed-in account.

When a game is created, `emailVersusGameResults` (in `functions/index.js`) sends the result by SMTP, each player in a message of their own so addresses are not shared. It then writes `emailStatus` on the game, which the page shows: `sent`, `failed` (with the reason), `not-configured`, `not-allowed`, `rate-limited`, `unfinished` or `in-match`. Unfinished games are saved but never emailed.

**A match (first to 2, 3, ...) is one email** (since Nov 15, 2026; before, each game of a match was emailed on its own). Each game of a match is saved with `matchId`, `leg` (which game) and `legsToWin`. A game that doesn't decide the match is marked `in-match` and sends nothing. The game that decides it reads the match's games (up to its own number) and sends one email: the match score ("Alex won the match 3-1"), each player over the whole match (games won, the average over all their darts, darts, best visit), then every game with its numbers and visit by visit. A match stopped partway (a game quit) sends the games finished so far as "Match not finished", and says how many were stopped; one stopped in its first game sends nothing. A single game (no match) is emailed as before.

Because anyone with a Google account can sign in to the app, the function is deliberately hard to misuse: it only sends for the account in `DARTS_OWNER_UID`, at most 20 games a day, to at most the two addresses on the game (checked for shape and for line breaks), with every name and score escaped. A game from any other account is saved and marked `not-allowed`.

## Setting up the email (one time)

Emails are sent from your Gmail account with an app password. Nothing is sent until this is done, and the game is marked "Email is not set up yet".

**Done on Nov 15, 2026:** the app password was already stored, but `SMTP_USER` and `MAIL_FROM` were blank, so every game until then was marked `not-configured` (those games are never emailed later: the email goes when a game is saved). Both now send from the owner's Gmail, and a test result arrived. When `functions/index.js` has someone's unfinished changes, deploy the email function from a clean `git worktree` of the committed code (with the `.env` copied in), so only it changes.

1. In your Google account, turn on 2-Step Verification, then create an app password at https://myaccount.google.com/apppasswords (a 16-character password).
2. Store it as a secret. The command asks for the value, so it is never written in a file or a chat:

   ```bash
   firebase functions:secrets:set SMTP_PASS --project dartstracker2026
   ```

3. In `functions/.env.dartstracker2026` (git-ignored) add the address that sends, using `functions/.env.example` as the template:

   ```text
   SMTP_USER=you@gmail.com
   MAIL_FROM=Darts Tracker <you@gmail.com>
   ```

   `SMTP_HOST` and `SMTP_PORT` default to Gmail (`smtp.gmail.com`, 465). Another SMTP service works by changing those and the secret.

4. Deploy the rules and the function first, then the page:

   ```bash
   firebase deploy --only firestore:rules,functions:emailVersusGameResults --project dartstracker2026
   firebase deploy --only hosting --project dartstracker2026
   ```

Gmail sends from the account it logs in as, whatever `MAIL_FROM` says, and limits how many messages a day it will send (about 500), far above the cap here.

## Privacy

The other player's email address is stored in your `versusGames` record and, for convenience, in this browser's local storage; it is used only to send that result. Deleting a game removes the record, not emails already sent.

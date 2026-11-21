# Playing against another player

On `practice.html`, "Play against: Another player" is for two people sharing one phone. The same board and keypad are used, and the two of you take turns. When the game is finished, the result is emailed to both players.

## Your players

The people you play against are kept with your account (since Nov 17, 2026), so each one is typed once and is there on every device: phone, iPad and computer.

With "Another player" chosen, **Who are you playing?** shows a button for each saved player, the one played or added last first. Tap one and the game is set up with their name and email address; their card shows the address, your games against them ("5 games played: you won 5, David won 0. Last played Nov 16.") and two buttons:

- **Edit** opens their name and address to change. An address another saved player already has is refused.
- **Remove** takes them off the list (it asks first). The games you played stay in your record.

**+ New player** opens the two boxes: their name (optional) and their email address (needed: the game cannot start without a valid one, and it cannot be your own). **Save player** (or Enter) adds them; so does **Start game**, so a new player can be typed and played straight away and is there next time. Without a name, one is made from the address ("ashtrower@..." is "Ashtrower"). The same address typed again is the same player, whatever its capitals.

The first time, the list starts by itself with the people already in your saved two-player games, each under the latest name you typed for them. It is only started once: someone you remove does not come back.

The name can also be changed during a game (since Nov 14, 2026): **Edit name** under the other player's score, or by their score in Board mode, asks for it. The new name is used at once on every device showing the game, called out, saved with the game and put in its email, and it becomes that saved player's name. Your own name gets a "2" added if typed for them. Once a game is over it can't be renamed: the record is already saved, and saved games are never changed. The first player is whoever is signed in, and their email is the one on the Google account. Names are used everywhere the bot's name would be, and if both are the same the second gets a "2".

The same list is used by **Score More: two players** on the Training page (`docs/training.md`), which can add a new player to it too.

How it is kept: one document, `savedPlayers/{uid}`, with a map of players (`name`, `email`, `addedAt`, `usedAt`), at most 50 (the rules take 60). A player's id is made from their email address (`public/players.js`, `idOf`), so the same person added on two devices at once is one player. The page listens to the document, so a change on one device shows on the others by itself. If the list can't be reached (offline, with nothing kept), the two boxes work as before and nothing is written. Rules: only the owner reads or writes it (`match /savedPlayers/{uid}` in `firestore.rules`).

Playing works as it does against the bot, with these differences:

- Each player enters their own darts, by board or keypad, and the turn passes to the other player after the third dart (or when Enter is pressed, if "Press Enter" is on). The status line says whose turn it is.
- Either player's last visit can be corrected: "Edit Alex's last visit" and "Edit Sam's last visit" are both shown, and correcting one leaves the other's darts as entered.
- Scores are announced for both, in the same voice (see `docs/bot-practice.md` for how the caller's energy changes with the score - that applies here too, just without the bot's lower pitch).
- Only your own darts, from any game type, go into "Yours" on the heat map. The second player's darts are not counted as "The bot's".
- **With the cameras** (since Nov 18, 2026, after the Nov 17 match against Ashley lost far more darts than games against the bot): pulling the darts out passes the turn at once (no 1.2 s wait), and a dart thrown by the next player before the turn had passed is theirs. Darts thrown after a bust are the thrower's until the darts come out, and aren't counted ("thrown before the last visit's darts were out"); they used to go into the other player's visit, and every visit after it was off by one. The next player's first dart, thrown the moment the board is clear, is no longer taken for the hand going away (see "Just after the darts come out" in [camera-scoring.md](camera-scoring.md)): it is counted when their second dart lands, or once it has sat still for 2 s.

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

## Time Left

Each saved game is also sent to Time Left To Live by `syncVersusGameToTimeLeft` (in `functions/index.js`, since Nov 16, 2026; the 11 games saved before that were sent the same day), for the account in `DARTS_OWNER_UID` only: a timed Darts item from when the game started, titled like "Won 501 vs Sam (avg 55.55)", with the result, both averages, the darts thrown and the best visit, and which game of a match it was. The other player's name is sent; their email address and both players' darts are not. Deleting a game on the page removes it from Time Left. See [time-left-sync.md](time-left-sync.md).

## Privacy

The other player's name and email address are stored in your `versusGames` records, in your saved players (`savedPlayers`, readable only by your account) and, for convenience, in this browser's local storage; the address is used only to send them the result. Removing a player takes them out of your saved players, not out of the games already saved. Their name (not their address) goes to your own Time Left with each game. Deleting a game removes the record (and its Time Left item), not emails already sent.

# OneTracker — Privacy Policy

_Last updated: 14 September 2026_

OneTracker is a personal media tracker for series, films, books, comics and
games. It is developed by an individual, is free, contains no advertising and
no analytics, and **collects nothing about you**.

This document is deliberately short, because there is very little to say.

## What OneTracker stores, and where

Everything you track — your library, progress, ratings, favourites, lists and
game playthroughs — is stored **only on your device**, in the app's own local
database. It is not uploaded anywhere by default, and the developer has no
access to it and no way to obtain it.

Uninstalling the app deletes that data.

## The optional Google Drive backup

If, and only if, you connect a Google account in Settings, OneTracker can copy
your library to **your own Google Drive**.

- It uses the `drive.appdata` scope, which can only see a private application
  folder inside your Drive. **OneTracker cannot read, list or touch any other
  file in your Drive**, including files created by other apps.
- The backup file contains your library and app preferences. It does not
  contain passwords or payment data.
- The file belongs to you and sits in your Drive. The developer never receives
  it, cannot read it, and has no server that stores a copy.
- Your name, e-mail and profile picture are read once to show you which account
  is connected, and are kept **on the device only**.
- Disconnecting the account in Settings deletes those details from the device
  and revokes OneTracker's access token with Google. You can also remove access
  at any time from your [Google account permissions](https://myaccount.google.com/permissions),
  and delete the backup file from Drive yourself.

## Information sent to third parties

To show titles, artwork, episode lists and ratings, the app requests public
catalogue data from these services:

The Movie Database (TMDB), IGDB, RAWG, HowLongToBeat, AniList, MangaDex,
MyAnimeList (via Jikan), Open Library, Comic Vine, OMDb, Steam and Wikipedia.

Those requests contain **what you searched for or opened** (for example a title
name or id). They do not contain your identity, your library, or any account
information. Most of them go through an intermediary server (a Cloudflare
Worker) operated by the developer, whose only purpose is to keep the API keys
out of the installed app and to reach services that browsers cannot call
directly. **That server stores nothing**: it forwards the request, returns the
answer, and keeps only a short-lived cache of the public catalogue responses —
never anything that identifies you.

Each of those services has its own privacy policy, which applies to the request
they receive.

## Children

OneTracker is not directed at children and collects no personal data from
anyone, of any age.

## Your rights

Since no personal data ever reaches the developer, there is nothing held about
you to access, correct, export or erase. The data on your device is exported
(Settings → export a backup file) and deleted (Settings → clear the library, or
uninstall) entirely by you, without asking anyone.

## Changes

If this policy ever changes, the updated version will be published at this same
address, with a new date at the top.

## Contact

Questions about this policy, or about the app: open an issue at
<https://github.com/Koisuji02/OneTracker/issues>.

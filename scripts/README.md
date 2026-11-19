# scripts

## Weekly rail network update

`scripts/update-network.ts` keeps `public/data` in step with the BTS NTAD North American Rail Network.
It asks the ArcGIS layer for its data edit date and compares it with `data/source-version.json`.
If the date is new, it rebuilds in a temporary copy of `pipeline/` (with the latest GeoNames town names for the
place labels), checks the result (the graph loads,
the selftest passes, every shop in `docs/shops/marmon-rail-shops-public.csv` routes from five origins and the
route ends within 2.5 km of the shop), and only then copies the new files over `public/data` and commits
them. If a check fails, the old data stays. Each run writes to `~/Library/Logs/visnarn-network-update.log`
and shows a macOS notification.

Run it by hand:

```sh
npm run data:update
tail -n 50 ~/Library/Logs/visnarn-network-update.log
```

The schedule (Monday 07:00; if the Mac is asleep then, it runs on wake) is the launchd agent
`launchd/com.visnarn.network-update.plist`. Install or update it:

```sh
cp scripts/launchd/com.visnarn.network-update.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.visnarn.network-update.plist
launchctl print gui/$(id -u)/com.visnarn.network-update     # check it is loaded
launchctl kickstart gui/$(id -u)/com.visnarn.network-update # run it now, as launchd would
```

Pause it (until the next `bootstrap` or login):

```sh
launchctl bootout gui/$(id -u)/com.visnarn.network-update
```

Remove it:

```sh
launchctl bootout gui/$(id -u)/com.visnarn.network-update
rm ~/Library/LaunchAgents/com.visnarn.network-update.plist
```

## Other scripts

- `free-port.mjs`: frees the app's port (`VISNARN_PORT`, default 5173) before `npm run dev` and `npm start`.
- `architecture.test.ts`: the import rules between areas (`shared`, `engine`, `server`, `web`), run by `npm test`.
- `copy.test.ts`: the wording rules for UI strings, messages, docs, comments and test names, run by `npm test`.

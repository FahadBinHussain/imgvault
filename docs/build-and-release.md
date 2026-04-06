# Build and Release Notes

## Extension

```powershell
cd nextgen-extension
pnpm build
```

Output:

- `nextgen-extension/dist`

Load this folder as unpacked extension in Chromium.

## Native Host

```powershell
cd native-host
pnpm portable:build
```

Output:

- `native-host/ImgVault-Native-Host.exe`

## Web App

```powershell
cd web
pnpm dev
pnpm build
```

## Practical Verification Checklist

After extension changes:

- reload unpacked extension from `dist`
- verify background + gallery logs reflect new bundle filename

After native-host changes:

- rebuild portable exe
- ensure installed/registered host points to updated executable
- test one native download and confirm new behavior in logs

After web changes:

- verify API route responses (`/api/config`, `/api/images`, `/api/share/...`)
- verify gallery lightbox fields/counts and Firestore link behavior

## Fast Incident Triage

If video flow is broken:

1. Confirm native download succeeded and returned a path
2. Check gallery logs for `NotFoundError` vs permission error
3. Verify filename/id-based fallback behavior
4. Confirm saved folder handle exists and is reusable
5. If needed, repick once, then retry

# Pairing

Pairing links the account to the desktop EXE that runs beside the cameras.

How it works:

- In Settings, generate a pairing code.
- The pairing code expires after 10 minutes.
- Enter the code in the EXE to claim the pairing.
- After pairing, the worker stores a connected row with client_id, exe_id, paired_at, last_seen_at, and timezone.
- Settings can show current pairing status and disconnect the EXE.

Important behavior:

- The client_id is stable per account.
- Re-pairing replaces the connected EXE token for that account.
- The EXE timezone is synchronized back to the account timezone when available.

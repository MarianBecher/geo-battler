# Playing from WSL2

WSL2 sits behind NAT by default, so the `172.x.x.x` address the server
prints at start-up is **not** reachable from other devices on the Wi-Fi.
Two ways out; in both cases the address for the other players is the
**Windows** LAN IP from `ipconfig`.

## a) Mirrored networking (Windows 11 22H2+)

In `C:\Users\<you>\.wslconfig`:

```ini
[wsl2]
networkingMode=mirrored

[experimental]
hostAddressLoopback=true
```

Then `wsl --shutdown` and start again. Two more things are needed:

* **`hostAddressLoopback=true`** - without it *Windows itself* only reaches
  the server under `localhost`.
* **The Hyper-V firewall** defaults to `DefaultInboundAction: Block` for
  WSL. In PowerShell **as admin**, once:

  ```powershell
  New-NetFirewallHyperVRule -Name "GeoBattle-3000" `
    -DisplayName "Geo Battle (WSL, port 3000)" -Direction Inbound `
    -VMCreatorId '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}' `
    -Protocol TCP -LocalPorts 3000 -Action Allow
  New-NetFirewallRule -DisplayName "Geo Battle (port 3000)" -Direction Inbound `
    -LocalPort 3000 -Protocol TCP -Action Allow
  ```

## b) Port proxy (older Windows)

In PowerShell **as admin**:

```powershell
netsh interface portproxy add v4tov4 listenport=3000 listenaddress=0.0.0.0 `
  connectport=3000 connectaddress=<WSL-IP>
New-NetFirewallRule -DisplayName "Geo Battle" -Direction Inbound `
  -LocalPort 3000 -Protocol TCP -Action Allow
```

The WSL IP changes on every restart, so the proxy rule has to be updated
each time.

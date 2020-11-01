# Google Home Client (Local Fulfillment)
This code runs on a Google Assistant device in your home and will call out to 
your WebThings gateway over the local network to discover devices and issue commands.

## Deployment
0. Login to your account at https://console.actions.google.com/

1. You already added the link to your server. (See [SERVER README](../server/README.md)).

2. Add a link to the client

    Under "Configure local home SDK (optional)" where your index.ts has been compiled into bundle.js. See example [here](https://webofthings-e2f7c.web.app/local-home/index.html).

3. Configure mdns scanning under "Add device scan configuration":

```
MDNS service name: _http._tcp.local
```
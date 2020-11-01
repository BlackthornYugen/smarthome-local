# Server (Cloud Fulfillment)
This server handles enrollment via oauth to WebThings as well as Cloud 
Fulfilment should you wish to implement it.

## Cloud Fulfilment
If the google assistant can't perform an action in a certian period of time,
it will attempt to send the command via the internet. I would prefer not to
support this at all but it might be nessisary for reliability.

## Deployment
1. Login to your account at https://console.actions.google.com/

2. Add the URL to your cloud fulfillment server.
# Problem

We want to build web application capable of real time display of internet connections on a world map. Each connection should be displayed as a dot on a World map based on the geolocation of its known IP address.

The scope of connections is my home network and will rely on the Mikrotik API to display details of the known connections. The BASE API url aas well as user and password will be configured via environment variables, "http://192.168.200.1/rest/ip/firewall/connection".

There is no need for a backend - this application will only run within my home network, so it can fully be a client side application that queries the router API directly. Any concerns regarding cross-origin requests should be ignored for now.

Even as a web application, the process of obtaining the geolocation of one IP address should be done asynchrnously.

## Geolocation

IP → geolocation is resolved against a **local offline database** bundled with the app (e.g. MaxMind GeoLite2 or an equivalent open dataset), read in-browser via a WASM/JS reader. No external geolocation API calls — every lookup stays local, so the app works fully offline within the home network. The DB file is treated as a static asset and can be refreshed periodically.

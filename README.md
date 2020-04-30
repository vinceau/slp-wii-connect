# `slp-wii-connect`

[![npm version](http://img.shields.io/npm/v/@vinceau/slp-wii-connect.svg?style=flat)](https://npmjs.org/package/@vinceau/slp-wii-connect "View this project on npm")
[![Build Status](https://github.com/vinceau/slp-wii-connect/workflows/build/badge.svg)](https://github.com/vinceau/slp-wii-connect/actions?workflow=build)
[![License](https://img.shields.io/npm/l/@vinceau/slp-wii-connect)](https://github.com/vinceau/slp-wii-connect/blob/master/LICENSE)

Extract raw [Slippi](https://github.com/project-slippi/project-slippi) data directly from the console or from a Slippi relay


## Table of Contents

<details>
<summary><strong>Details</strong></summary>

* [Installation](#installation)
* [Usage](#usage)
* [API](#api)
  * [Methods](#methods)
    * [connect](#connectip-port-timeout)
    * [disconnect](#disconnect)
    * [getStatus](#getstatus)
    * [getSettings](#getsettings)
    * [getDetails](#getdetails)
  * [Events](#events)
    * [data](#data)
    * [handshake](#handshake)
    * [statusChange](#statuschange)
  * [Types](#types)
    * [ConnectionSettings](#connectionsettings)
    * [ConnectionDetails](#connectiondetails)
    * [ConnectionStatus](#connectionstatus)
* [Development](#development)
* [Acknowledgements](#acknowledgements)
* [License](#license)

</details>


## Installation

**With NPM**

```bash
npm install @vinceau/slp-wii-connect
```

**With Yarn**

```bash
yarn add @vinceau/slp-wii-connect
```

## Usage

```javascript
const { ConsoleConnection } = require("@vinceau/slp-wii-connect");

const connection = new ConsoleConnection();
connection.connect("133.221.123.111", 1667);

connection.on("data", (data) => {
  // Received data from console
  console.log(data);
});

connection.on("statusChange", (status) => {
  console.log(`status changed: ${status}`);
});
```

## API

### Methods

#### `connect(ip, port, [timeout])`

Attempt connection to a Wii or Slippi relay.

##### ip

The IP address to connect to.

* Required: `true`
* Type: `string`

##### port

The port to connect through.

* Required: `true`
* Type: `number`

##### [timeout]

The milliseconds to wait before a connection attempt fails.

* Required: `false`
* Type: `number`

#### `disconnect()`

Terminates the existing connection.

#### `getStatus()`

Returns [`ConnectionStatus`](#connectionstatus).

#### `getSettings()`

Returns [`ConnectionSettings`](#connectionsettings).

#### `getDetails()`

Returns [`ConnectionDetails`](#connectiondetails).

### Events

You can subscribe to the following events using the `connection.on()` method. For example:

```javascript
connection.on("data", (data) => {
  console.log(`Got the following data: ${data}`);
});
```

#### data

* `(data: Uint8Array) => void`

Emitted when game data is received.

#### handshake

* `(details: ConnectionDetails) => void`

Emitted for all handshake messages.

#### statusChange

* `(status: ConnectionStatus) => void`

Emitted whenever the connection status changes.

### Types

#### `ConnectionSettings`

| Key         | Type   |
| ----------- | ------ |
| `ipAddress` | string |
| `port`      | number |

#### `ConnectionDetails`

| Key               | Type       |
| ----------------- | ---------- |
| `consoleNickname` | string     |
| `gameDataCursor`  | Uint8Array |
| `version`         | string     |
| `clientToken`     | number     |

#### `ConnectionStatus`

A number representing the current connection status. Possible values are as follows:

| Value  | Status        |
| ------ | ------------- |
| 0      | Disconnected  |
| 1      | Connecting    |
| 2      | Connected     |
| 3      | Reconnecting  |


## Development

To build the library from source:

```bash
yarn run build
```

To start the development server:

```bash
yarn run watch
```

## Acknowledgements

This library is largely taken from code available in the [`slippi-desktop-app`](https://github.com/project-slippi/slippi-desktop-app). Credits to [Jas Laferriere](https://github.com/JLaferri) and the rest of the [Project Slippi](https://github.com/project-slippi) team.

## License

This software is released under the terms of [LGPL-3.0](LICENSE) license.

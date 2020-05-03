/**
 * Copyright 2019, Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/// <reference types="@google/local-home-sdk" />

import App = smarthome.App;
import Constants = smarthome.Constants;
import DataFlow = smarthome.DataFlow;
import Execute = smarthome.Execute;
import Intents = smarthome.Intents;
import IntentFlow = smarthome.IntentFlow;

const SERVER_PORT = 3388;

interface IGoogleParams {
  on?: boolean,
  start?: boolean,
  pause?: boolean,
  brightness?: number,
}

interface IMozillaParams {
  level?: number, // Map to brightness
  on?: boolean, // map to on
}

class LocalExecutionApp {

  constructor(private readonly app: App) { }

  identifyHandler(request: IntentFlow.IdentifyRequest):
      Promise<IntentFlow.IdentifyResponse> {
        console.debug("IDENTIFY intent: " + JSON.stringify(request, null, 2));

      const udpScanData = request.inputs[0].payload.device.udpScanData;
      const mdnsScanData = request.inputs[0].payload.device.mdnsScanData;

      if (udpScanData == undefined && mdnsScanData == undefined) {
        const err = new IntentFlow.HandlerError(request.requestId,
            'invalid_request', 'Invalid scan data');
        return Promise.reject(err);
      }

      // In this codelab, the scan data contains only local device id.
      let discoveredDevice: IntentFlow.IdentifyResponsePayload;

      if (udpScanData) {
        discoveredDevice = { device:  {
          id: 'washer',
          verificationId: Buffer.from(udpScanData.data, 'hex').toString(),
        }};
      } else {
        discoveredDevice = { device: {
          id: 'hub',
          isProxy: true,
          isLocalOnly: true,
        }};
      }

      const response: IntentFlow.IdentifyResponse = {
        intent: Intents.IDENTIFY,
        requestId: request.requestId,
        payload: discoveredDevice
      };

      console.debug("IDENTIFY response: " + JSON.stringify(response, null, 2));

      return Promise.resolve(response);
  }

  executeHandler(request: IntentFlow.ExecuteRequest):
      Promise<IntentFlow.ExecuteResponse> {
    console.debug("EXECUTE intent: " + JSON.stringify(request, null, 2));

    const command = request.inputs[0].payload.commands[0];
    const execution = command.execution[0];
    const response = new Execute.Response.Builder()
      .setRequestId(request.requestId);

    const promises: Array<Promise<void>> = command.devices.map((device) => {
      console.debug("Handling EXECUTE intent for device: " + JSON.stringify(device));

      // Convert execution params to a string for the local device
      const params = execution.params as IGoogleParams;
      const payload = this.getDataForCommand(execution.command, params);

      // @ts-ignore
      if (!device.customData.authorization) {
        console.debug("no token supplied in custom data");
        return Promise.reject('no token');
      }
      // @ts-ignore
      const bearerToken = device.customData.authorization;

      let deviceId;
      switch (device.id) {
        case "washer":
            deviceId = "/things/zb-500b91400001e9d1";
          break;
        default:
          deviceId = device.id;
      }

      let propertyName: string;
      let propertyBody: IMozillaParams;
      switch (execution.command) {
        case "action.devices.commands.OnOff":
          propertyName = "on";
          propertyBody = {on: params.on};
          break;
        case "action.devices.commands.BrightnessAbsolute":
          propertyName = "level";
          propertyBody = {level: params.brightness};
          break;
        default:
          return Promise.reject(`Unsupported execution command: ${execution.command}`);
      }

      fetch(`https://steelcomputers.mozilla-iot.org${deviceId}/properties/${propertyName}`, {
        method: 'PUT',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': bearerToken,
        },
        body: JSON.stringify(propertyBody),
      }).then(res => {
        console.debug('called mozilla gateway successfully');
        console.debug(res);
      }).catch(things => {
        console.debug('error calling mozilla gateway');
        console.debug(things);
      });

      // Create a command to send over the local network
      const radioCommand = new DataFlow.HttpRequestData();
      radioCommand.requestId = request.requestId;
      radioCommand.deviceId = device.id;
      radioCommand.data = JSON.stringify(payload);
      radioCommand.dataType = 'application/json';
      radioCommand.port = SERVER_PORT;
      radioCommand.method = Constants.HttpOperation.POST;
      radioCommand.isSecure = false;

      console.debug("Sending request to the smart home device:", payload);

      return this.app.getDeviceManager()
        .send(radioCommand)
        .then(() => {
          const state = {online: true};
          response.setSuccessState(device.id, Object.assign(state, params));
          console.debug(`Command successfully sent to ${device.id}`);
        })
        .catch((e: IntentFlow.HandlerError) => {
          e.errorCode = e.errorCode || 'invalid_request';
          const state = {online: true};
          response.setSuccessState(device.id, state);
          console.debug('An error occurred sending the command', e.errorCode);
        });
    });

    return Promise.all(promises)
      .then(() => {
        return response.build();
      })
      .catch((e) => {
        const err = new IntentFlow.HandlerError(request.requestId,
            'invalid_request', e.message);
        return Promise.reject(err);
      });
  }

  /**
   * Convert execution request into a local device command
   */
  getDataForCommand(command: string, params: IGoogleParams): unknown {
    switch (command) {
      case 'action.devices.commands.OnOff':
        return {
          on: params.on ? true : false
        };
      case 'action.devices.commands.StartStop':
        return {
          isRunning: params.start ? true : false
        };
      case 'action.devices.commands.PauseUnpause':
        return {
          isPaused: params.pause ? true : false
        };
      default:
        console.debug('Unknown washer command', command);
        return {};
    }
  }

  /**
   * Google home device responds to a query about what IoT Devices are available.
   */
  reachableDevicesHandler(request: IntentFlow.ReachableDevicesRequest):
      IntentFlow.ReachableDevicesResponse {

    console.debug("Handling REACHABLE intent for device: %s ", JSON.stringify(request));

    // Reference to the local proxy device
    const proxyDeviceId = request.inputs[0].payload.device.id;

    const reachableDevices = request.devices
        .filter(d => d.id.startsWith("/things/zb")) // all zigbee (zb) devices. this filters out phillips hue devices
        .map(d => new Object({verificationId: d.id}));

    // Return a response
    return {
      intent: Intents.REACHABLE_DEVICES,
      requestId: request.requestId,
      payload: {
        devices: reachableDevices,
      },
    };
  };
}

const localHomeSdk = new App('1.0.0');
const localApp = new LocalExecutionApp(localHomeSdk);
localHomeSdk
  .onReachableDevices(localApp.reachableDevicesHandler.bind(localApp))
  .onIdentify(localApp.identifyHandler.bind(localApp))
  .onExecute(localApp.executeHandler.bind(localApp))
  .listen()
  .then(() => console.log(new Date()))
  .catch((e: Error) => console.error(e));

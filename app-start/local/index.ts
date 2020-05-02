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
import Execute = smarthome.Execute;
import Intents = smarthome.Intents;
import IntentFlow = smarthome.IntentFlow;

const agentUserId = "123";

class LocalExecutionApp {

  constructor(private readonly app: App) { }

  identifyHandler(request: IntentFlow.IdentifyRequest):
      Promise<IntentFlow.IdentifyResponse> {
        console.log("IDENTIFY intent: %s %s", new Date(), JSON.stringify(request, null, 2));

      const scanData = request.inputs[0].payload.device.udpScanData;
      if (!scanData) {
        const err = new IntentFlow.HandlerError(request.requestId,
            'invalid_request', 'Invalid scan data');
        return Promise.reject(err);
      }

      // In this codelab, the scan data contains only local device id.
      const localDeviceId = Buffer.from(scanData.data, 'hex');

      const response: IntentFlow.IdentifyResponse = {
        intent: Intents.IDENTIFY,
        requestId: request.requestId,
        payload: {
          device: {
            id: agentUserId,
            isLocalOnly: true,
            isProxy: true,
          }
        }
      };
      console.log("IDENTIFY response: " + JSON.stringify(response, null, 2));

      return Promise.resolve(response);
  }

  executeHandler(request: IntentFlow.ExecuteRequest):
      Promise<IntentFlow.ExecuteResponse> {
    console.log("EXECUTE intent: " + JSON.stringify(request, null, 2));

    const command = request.inputs[0].payload.commands[0];
    const execution = command.execution[0];
    const response = new Execute.Response.Builder()
      .setRequestId(request.requestId);

    const promises: Array<Promise<any>> = command.devices.map( async (device) => {
      console.log("Handling EXECUTE intent for device: " + JSON.stringify(device));

      // Convert execution params to a string for the local device
      const params = execution.params as any;

      // @ts-ignore
      if (!device.customData.authorization) {
        console.log("no token supplied in custom data");
        return Promise.reject('no token');
      }

      // @ts-ignore
      const bearerToken = device.customData.authorization;

      // @ts-ignore
      const urlBase = device.customData.urlBase;

      let mozPropertyName = null;
      let mozBody = null;

      // Handle local LAN logic
      switch (execution.command) {
        case "action.devices.commands.OnOff":
          mozPropertyName = 'on';
          mozBody = {on: !!params.on};
          break;
        case "action.devices.commands.BrightnessAbsolute":
          mozPropertyName = 'level'
          mozBody = {level: params.brightness};
          break;
        default:
          console.error("Unknown command: " + execution.command);
          console.log(params);
          // return
      }

      const updateMozResponse = await fetch(urlBase + device.id + '/properties/' + mozPropertyName, {
        method: 'PUT',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': bearerToken,
        },
        body: JSON.stringify(mozBody),
      });

      return updateMozResponse; // FIXME: Handle errors?
    });

    return Promise.all(promises)
      .then(() => {
        return response.build();
      })
      .catch((e) => {
        console.error("Failed to sync", e)
        const err = new IntentFlow.HandlerError(request.requestId,
            'invalid_request', e.message);
        return Promise.reject(err);
      });
  }

  /**
   * Convert execution request into a local device command
   */
  getDataForCommand(command: string, params: IWasherParams): unknown {
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
        console.error('Unknown command', command);
        return {};
    }
  }

  /**
   * Google home device responds to a query about what IoT Devices are available.
   */
  reachableDevicesHandler(request: IntentFlow.ReachableDevicesRequest):
      IntentFlow.ReachableDevicesResponse {

    console.log("Handling EXECUTE intent for device: %s ", JSON.stringify(request));

    // Reference to the local proxy device
    const proxyDeviceId = request.inputs[0].payload.device.id;

    // Gather additional device ids reachable by local proxy device
    // ...

    const reachableDevices = [
      // Each verificationId must match one of the otherDeviceIds
      // in the SYNC response
      { verificationId: "/things/zb-500b91400001e9d1" },
      { verificationId: "local-device-id-2" },
    ];

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
  .then(() => console.log('Ready'))
  .catch((e: Error) => console.error(e));

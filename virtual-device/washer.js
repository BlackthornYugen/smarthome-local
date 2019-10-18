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

const axios = require('axios');
const logger = require('./logger');

/**
 * Representation of a smart washer device.
 */
class Washer {
  /**
   * Create a new washer instance
   * @param {string} projectId Endpoint to publish state updates
   */
  constructor(projectId) {
    this.reportStateEndpointUrl = `https://${projectId}.firebaseapp.com/updateState`;
    this._state = {
      on: false,
      isRunning: false,
      isPaused: false,
    };
    this.reportState();
  }

  /**
   * Turn on.
   */
  on() {
    if (this._state.on === false) {
      this.state = {
        on: true,
      };
    }
  }

  /**
   * Turn off.
   */
  off() {
    if (this._state.on === true) {
      this.state = {
        on: false,
        // also un-pause and stop the device.
        isRunning: false,
        isPaused: false,
      };
    }
  }

  /**
   * Start new cycle.
   */
  start() {
    if (this._state.on === true &&
        this._state.isRunning === false) {
      this.state = {
        isRunning: true,
        // also resume the device.
        isPaused: false,
      };
    }
  }

  /**
   * Stop current cycle.
   */
  stop() {
    if (this._state.on === true &&
        this._state.isRunning === true) {
      this.state = {
        isRunning: false,
        // also un-pause the device.
        isPaused: false,
      };
    }
  }

  /**
   * Pause current cycle.
   */
  pause() {
    if (this._state.on === true &&
        this._state.isRunning === true &&
        this._state.isPaused === false) {
      this.state = {
        isPaused: true,
      };
    }
  }

  /**
   * Resume current cycle.
   */
  resume() {
    if (this._state.on === true &&
        this._state.isRunning === true &&
        this._state.isPaused === true) {
      this.state = {
        isPaused: false,
      };
    }
  }

  /**
   * Update device state
   * @param {*} params Updated state attributes
   */
  set state(params) {
    this._state = Object.assign(this._state, params);
    this.print();
    this.reportState();
  }

  /**
   * Print the current device state
   */
  print() {
    if (this._state.on) {
      const runState = this._state.isPaused
        ? 'PAUSED' : this._state.isRunning ? 'RUNNING' : 'STOPPED';
      logger.info(`***** The washer is ${runState} *****`);
    } else {
      logger.info(`***** The washer is OFF *****`);
    }
  }

  /**
   * Publish the current state to remote endpoint
   */
  reportState() {
    axios.post(this.reportStateEndpointUrl, this._state)
      .then((res) => {
        logger.info('Report State successful');
      })
      .catch((err) => {
        logger.error(`Report State error: ${err.message}`);
      });
  }
}

module.exports = Washer;

'use strict';

const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;

const XboxWebApi = require('xbox-webapi');
const Smartglass = require('./src/smartglass.js');
const mqttClient = require('./src/mqtt.js');

const PLUGIN_NAME = 'homebridge-xbox-tv';
const PLATFORM_NAME = 'XboxTv';

const CONSOLES_NAME = {
	'XboxSeriesX': 'Xbox Series X',
	'XboxSeriesS': 'Xbox Series S',
	'XboxOne': 'Xbox One',
	'XboxOneS': 'Xbox One S',
	'XboxOneX': 'Xbox One X'
};
const CONSOLE_POWER_STATE = {
	'Off': 0,
	'On': 1,
	'ConnectedStandby': 2,
	'SystemUpdate': 3,
	'Unknown': 4
};
const CONSOLE_PLAYBACK_STATE = {
	'Stopped': 0,
	'Playing': 1,
	'Paused': 2,
	'Unknown': 3
};
const DEFAULT_INPUTS = [{
		'name': 'Screensaver',
		'titleId': '851275400',
		'reference': 'Xbox.IdleScreen_8wekyb3d8bbwe!Xbox.IdleScreen.Application',
		'oneStoreProductId': 'Screensaver',
		'type': 'HOME_SCREEN',
		'contentType': 'Dashboard'
	},
	{
		'name': 'Dashboard',
		'titleId': '750323071',
		'reference': 'Xbox.Dashboard_8wekyb3d8bbwe!Xbox.Dashboard.Application',
		'oneStoreProductId': 'Dashboard',
		'type': 'HOME_SCREEN',
		'contentType': 'Dashboard'
	},
	{
		'name': 'Settings',
		'titleId': '1837352387',
		'reference': 'Microsoft.Xbox.Settings_8wekyb3d8bbwe!Xbox.Settings.Application',
		'oneStoreProductId': 'Settings',
		'type': 'HOME_SCREEN',
		'contentType': 'Dashboard'
	},
	{
		'name': 'Television',
		'titleId': '371594669',
		'reference': 'Microsoft.Xbox.LiveTV_8wekyb3d8bbwe!Microsoft.Xbox.LiveTV.Application',
		'oneStoreProductId': 'Television',
		'type': 'HDMI',
		'contentType': 'systemApp'
	},
	{
		'name': 'Settings TV',
		'titleId': '2019308066',
		'reference': 'Microsoft.Xbox.TvSettings_8wekyb3d8bbwe!Microsoft.Xbox.TvSettings.Application',
		'oneStoreProductId': 'SettingsTv',
		'type': 'HOME_SCREEN',
		'contentType': 'Dashboard'
	},
	{
		'name': 'Accessory',
		'titleId': '758407307',
		'reference': 'Microsoft.XboxDevices_8wekyb3d8bbwe!App',
		'oneStoreProductId': 'Accessory',
		'type': 'HOME_SCREEN',
		'contentType': 'systemApp'
	},
	{
		'name': 'Network Troubleshooter',
		'titleId': '1614319806',
		'reference': 'Xbox.NetworkTroubleshooter_8wekyb3d8bbwe!Xbox.NetworkTroubleshooter.Application',
		'oneStoreProductId': 'NetworkTroubleshooter',
		'type': 'HOME_SCREEN',
		'contentType': 'systemApp'
	},
	{
		'name': 'Microsoft Store',
		'titleId': '1864271209',
		'reference': 'Microsoft.storify_8wekyb3d8bbwe!App',
		'oneStoreProductId': 'MicrosoftStore',
		'type': 'HOME_SCREEN',
		'contentType': 'systemApp'
	}
];

const SYSTEM_MEDIA_COMMANDS = {
	play: 2,
	pause: 4,
	playpause: 8,
	stop: 16,
	record: 32,
	nextTrack: 64,
	prevTrack: 128,
	fastForward: 256,
	rewind: 512,
	channelUp: 1024,
	channelDown: 2048,
	back: 4096,
	view: 8192,
	menu: 16384,
	seek: 32786
};

const SYSTEM_INPUTS_COMMANDS = {
	nexus: 2,
	view1: 4,
	menu1: 8,
	a: 16,
	b: 32,
	x: 64,
	y: 128,
	up: 256,
	down: 512,
	left: 1024,
	right: 2048
};

const TV_REMOTE_COMMANDS = {
	volUp: 'btn.vol_up',
	volDown: 'btn.vol_down',
	volMute: 'btn.vol_mute'
};

const INPUT_SOURCE_TYPES = ['OTHER', 'HOME_SCREEN', 'TUNER', 'HDMI', 'COMPOSITE_VIDEO', 'S_VIDEO', 'COMPONENT_VIDEO', 'DVI', 'AIRPLAY', 'USB', 'APPLICATION'];

let Accessory, Characteristic, Service, Categories, UUID;

module.exports = (api) => {
	Accessory = api.platformAccessory;
	Characteristic = api.hap.Characteristic;
	Service = api.hap.Service;
	Categories = api.hap.Categories;
	UUID = api.hap.uuid;
	api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, xboxTvPlatform, true);
};


class xboxTvPlatform {
	constructor(log, config, api) {
		// only load if configured
		if (!config || !Array.isArray(config.devices)) {
			log('No configuration found for %s', PLUGIN_NAME);
			return;
		}
		this.log = log;
		this.api = api;
		this.devices = config.devices || [];
		this.accessories = [];

		this.api.on('didFinishLaunching', () => {
			this.log.debug('didFinishLaunching');
			for (let i = 0; i < this.devices.length; i++) {
				const device = this.devices[i];
				if (!device.name || !device.host || !device.xboxLiveId) {
					this.log.warn('Device Name, Host or Xbox Live ID Missing');
				} else {
					new xboxTvDevice(this.log, device, this.api);
				}
			}
		});
	}

	configureAccessory(accessory) {
		this.log.debug('configureAccessory');
		this.accessories.push(accessory);
	}

	removeAccessory(accessory) {
		this.log.debug('removeAccessory');
		this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
	}
}

class xboxTvDevice {
	constructor(log, config, api) {
		this.log = log;
		this.config = config;
		this.api = api;

		//device configuration
		this.name = config.name || 'Game console';
		this.host = config.host;
		this.xboxLiveId = config.xboxLiveId;
		this.webApiControl = config.webApiControl || false;
		this.clientId = config.clientId || '5e5ead27-ed60-482d-b3fc-702b28a97404';
		this.clientSecret = config.clientSecret || false;
		this.userToken = config.userToken;
		this.userHash = config.userHash;
		this.xboxWebApiToken = config.xboxWebApiToken || '';
		this.disableLogInfo = config.disableLogInfo || false;
		this.disableLogDeviceInfo = config.disableLogDeviceInfo || false;
		this.enableDebugMode = config.enableDebugMode || false;
		this.volumeControl = config.volumeControl || 0;
		this.infoButtonCommand = config.infoButtonCommand || 'nexus';
		this.getInputsFromDevice = config.getInputsFromDevice || false;
		this.filterGames = config.filterGames || false;
		this.filterApps = config.filterApps || false;
		this.filterSystemApps = config.filterSystemApps || false;
		this.filterDlc = config.filterDlc || false;
		this.inputs = config.inputs || [];
		this.buttons = config.buttons || [];
		this.enableMqtt = config.enableMqtt || false;
		this.mqttHost = config.mqttHost;
		this.mqttPort = config.mqttPort || 1883;
		this.mqttPrefix = config.mqttPrefix;
		this.mqttAuth = config.mqttAuth || false;
		this.mqttUser = config.mqttUser;
		this.mqttPasswd = config.mqttPasswd;
		this.accesoryType = config.accessoryType;
		this.mqttDebug = config.mqttDebug || false;

		//add configured inputs to the default inputs
		const inputsArr = new Array();
		const defaultInputsCount = DEFAULT_INPUTS.length;
		for (let i = 0; i < defaultInputsCount; i++) {
			inputsArr.push(DEFAULT_INPUTS[i]);
		}
		const inputsCount = this.inputs.length;
		for (let j = 0; j < inputsCount; j++) {
			const obj = {
				'name': this.inputs[j].name,
				'titleId': this.inputs[j].titleId,
				'reference': this.inputs[j].reference,
				'oneStoreProductId': this.inputs[j].oneStoreProductId,
				'type': this.inputs[j].type,
				'contentType': 'Game'
			}
			inputsArr.push(obj);
		}
		this.inputs = inputsArr;

		//device
		this.manufacturer = 'Microsoft';
		this.modelName = 'Model Name';
		this.serialNumber = this.xboxLiveId;
		this.firmwareRevision = 'Firmware Revision';
		this.devInfo = '';

		//setup variables
		this.webApiEnabled = false;

		this.inputsReference = new Array();
		this.inputsOneStoreProductId = new Array();
		this.inputsName = new Array();
		this.inputsTitleId = new Array();
		this.inputsType = new Array();

		this.powerState = false;
		this.volume = 0;
		this.muteState = true;
		this.mediaState = 0;
		this.inputIdentifier = 0;

		this.pictureMode = 0;
		this.brightness = 0;

		this.prefDir = path.join(api.user.storagePath(), 'xboxTv');
		this.authTokenFile = `${this.prefDir}/authToken_${this.host.split('.').join('')}`;
		this.devInfoFile = `${this.prefDir}/devInfo_${this.host.split('.').join('')}`;
		this.inputsFile = `${this.prefDir}/inputs_${this.host.split('.').join('')}`;
		this.inputsNamesFile = `${this.prefDir}/inputsNames_${this.host.split('.').join('')}`;
		this.inputsTargetVisibilityFile = `${this.prefDir}/inputsTargetVisibility_${this.host.split('.').join('')}`;

		//check if the directory exists, if not then create it
		if (fs.existsSync(this.prefDir) == false) {
			fs.mkdirSync(this.prefDir);
		}
		if (fs.existsSync(this.authTokenFile) == false) {
			fs.writeFileSync(this.authTokenFile, '');
		}
		if (fs.existsSync(this.devInfoFile) == false) {
			const obj = {
				'manufacturer': this.manufacturer,
				'modelName': this.modelName,
				'serialNumber': this.serialNumber,
				'firmwareRevision': this.firmwareRevision
			};
			const devInfo = JSON.stringify(obj, null, 2);
			fs.writeFileSync(this.devInfoFile, devInfo);
		}
		if (fs.existsSync(this.inputsFile) == false) {
			fs.writeFileSync(this.inputsFile, '');
		}
		if (fs.existsSync(this.inputsNamesFile) == false) {
			fs.writeFileSync(this.inputsNamesFile, '');
		}
		if (fs.existsSync(this.inputsTargetVisibilityFile) == false) {
			fs.writeFileSync(this.inputsTargetVisibilityFile, '');
		}

		//mqtt client
		this.mqttClient = new mqttClient({
			enabled: this.enableMqtt,
			host: this.mqttHost,
			port: this.mqttPort,
			prefix: this.mqttPrefix,
			topic: this.name,
			auth: this.mqttAuth,
			user: this.mqttUser,
			passwd: this.mqttPasswd,
			debug: this.mqttDebug
		});

		this.mqttClient.on('connected', (message) => {
				this.log('Device: %s %s, %s', this.host, this.name, message);
			})
			.on('error', (error) => {
				this.log('Device: %s %s, %s', this.host, this.name, error);
			})
			.on('debug', (message) => {
				this.log('Device: %s %s, debug: %s', this.host, this.name, message);
			})
			.on('message', (message) => {
				this.log('Device: %s %s, %s', this.host, this.name, message);
			})
			.on('disconnected', (message) => {
				this.log('Device: %s %s, %s', this.host, this.name, message);
			});

		//web api client
		if (this.webApiControl) {
			this.xboxWebApi = XboxWebApi({
				clientId: this.clientId,
				clientSecret: this.clientSecret,
				userToken: this.userToken,
				uhs: this.userHash
			});
			this.getAuthorizationState();

			setInterval(() => {
				this.getAuthorizationState();
			}, 600000);
		};

		//xbox client
		this.xbox = new Smartglass({
			host: this.host,
			xboxLiveId: this.xboxLiveId,
			userToken: this.userToken,
			uhs: this.userHash,
			infoLog: this.disableLogInfo,
			debugLog: this.enableDebugMode,
			mqttEnabled: this.enableMqtt
		});

		this.xbox.on('connected', (message) => {
				this.log('Device: %s %s, %s', this.host, this.name, message)
			})
			.on('error', (error) => {
				this.log('Device: %s %s, %s', this.host, this.name, error);
			})
			.on('debug', (message) => {
				this.log('Device: %s %s, %s', this.host, this.name, message);
			})
			.on('message', (message) => {
				this.log('Device: %s %s, %s', this.host, this.name, message);
			})
			.on('deviceInfo', async (firmwareRevision) => {
				if (!this.disableLogDeviceInfo) {
					this.log('-------- %s --------', this.name);
					this.log('Manufacturer: %s', this.manufacturer);
					this.log('Model: %s', this.modelName);
					this.log('Serialnr: %s', this.serialNumber);
					this.log('Firmware: %s', firmwareRevision);
					this.log('----------------------------------');
				}

				const obj = {
					'manufacturer': this.manufacturer,
					'modelName': this.modelName,
					'serialNumber': this.serialNumber,
					'firmwareRevision': firmwareRevision
				};
				const devInfo = JSON.stringify(obj, null, 2);
				try {
					const writeDevInfo = await fsPromises.writeFile(this.devInfoFile, devInfo);
					const debug = this.enableDebugMode ? this.log('Device: %s %s, debug writeDevInfo: %s', this.host, this.name, devInfo) : false;
				} catch (error) {
					this.log.error('Device: %s %s, get Device Info error: %s', this.host, this.name, error);
				};

				this.devInfo = devInfo;
				this.firmwareRevision = firmwareRevision;
			})
			.on('stateChanged', (power, titleId, inputReference, volume, mute, mediaState) => {

				const powerState = power;
				const inputIdentifier = this.inputsReference.indexOf(inputReference) >= 0 ? this.inputsReference.indexOf(inputReference) : this.inputsTitleId.indexOf(titleId) >= 0 ? this.inputsTitleId.indexOf(titleId) : this.inputIdentifier;

				//update characteristics
				if (this.televisionService) {
					this.televisionService
						.updateCharacteristic(Characteristic.Active, powerState)
						.updateCharacteristic(Characteristic.ActiveIdentifier, inputIdentifier);
				};

				if (this.speakerService) {
					this.speakerService
						.updateCharacteristic(Characteristic.Volume, volume)
						.updateCharacteristic(Characteristic.Mute, mute);
					if (this.volumeService && this.volumeControl == 1) {
						this.volumeService
							.updateCharacteristic(Characteristic.Brightness, volume)
							.updateCharacteristic(Characteristic.On, !mute);
					};
					if (this.volumeServiceFan && this.volumeControl == 2) {
						this.volumeServiceFan
							.updateCharacteristic(Characteristic.RotationSpeed, volume)
							.updateCharacteristic(Characteristic.On, !mute);
					};
				};

				this.powerState = powerState;
				this.volume = volume;
				this.muteState = mute;
				this.mediaState = mediaState;
				this.inputIdentifier = inputIdentifier;
				this.mqttClient.send('Info', this.devInfo);
			})
			.on('mqtt', (topic, message) => {
				this.mqttClient.send(topic, message);
			})
			.on('disconnected', (message) => {
				this.log('Device: %s %s, %s', this.host, this.name, message);
			});

		//start prepare accessory
		this.prepareAccessory();
	}

	async getAuthorizationState() {
		try {
			this.log.debug('Device: %s %s, requesting authorization state.', this.host, this.name);
			this.xboxWebApi._authentication._tokensFile = this.authTokenFile;
			await this.xboxWebApi.isAuthenticated();
			this.webApiEnabled = true;
			const debug = this.enableDebugMode ? this.log('Device: %s %s, Authorized and Web Api enabled.', this.host, this.name) : false;

			try {
				this.log.debug('Device: %s %s, requesting web api console data.', this.host, this.name);
				//await this.getWebApiConsolesList();
				//await this.getWebApiUserProfile();
				await this.getWebApiInstalledApps();
				//await this.getWebApiStorageDevices();
				await this.getWebApiConsoleStatus();
			} catch (error) {
				this.log.error('Device: %s %s, get web api console data error: %s.', this.host, this.name, error);
			};
		} catch (error) {
			this.webApiEnabled = false;
			this.log.error('Device: %s %s, not authorized, please use Authorization Manager.', this.host, this.name);
		};
	};

	getWebApiConsolesList() {
		return new Promise(async (resolve, reject) => {
			this.log.debug('Device: %s %s, requesting web api consoles list.', this.host, this.name);
			try {
				const getConsolesListData = await this.xboxWebApi.getProvider('smartglass').getConsolesList();
				const debug = this.enableDebugMode ? this.log('Device: %s %s, debug getConsolesListData, result: %s, %s', this.host, this.name, getConsolesListData.result[0], getConsolesListData.result[0].storageDevices[0]) : false;
				const consolesListData = getConsolesListData.result;

				this.consolesId = new Array();
				this.consolesName = new Array();
				this.consolesLocale = new Array();
				this.consolesRegion = new Array();
				this.consolesConsoleType = new Array();
				this.consolesPowerState = new Array();
				this.consolesDigitalAssistantRemoteControlEnabled = new Array();
				this.consolesConsoleStreamingEnabled = new Array();
				this.consolesRemoteManagementEnabled = new Array();
				this.consolesWirelessWarning = new Array();
				this.consolesOutOfHomeWarning = new Array();

				this.consolesStorageDeviceId = new Array();
				this.consolesStorageDeviceName = new Array();
				this.consolesIsDefault = new Array();
				this.consolesFreeSpaceBytes = new Array();
				this.consolesTotalSpaceBytes = new Array();
				this.consolesIsGen9Compatible = new Array();

				const consolesListCount = consolesListData.length;
				for (let i = 0; i < consolesListCount; i++) {
					const id = consolesListData[i].id;
					const name = consolesListData[i].name;
					const locale = consolesListData[i].locale;
					const region = consolesListData[i].region;
					const consoleType = consolesListData[i].consoleType;
					const powerState = CONSOLE_POWER_STATE[consolesListData[i].powerState]; // 0 - Off, 1 - On, 2 - ConnectedStandby, 3 - SystemUpdate
					const digitalAssistantRemoteControlEnabled = (consolesListData[i].digitalAssistantRemoteControlEnabled == true);
					const remoteManagementEnabled = (consolesListData[i].remoteManagementEnabled == true);
					const consoleStreamingEnabled = (consolesListData[i].consoleStreamingEnabled == true);
					const wirelessWarning = (consolesListData[i].wirelessWarning == true);
					const outOfHomeWarning = (consolesListData[i].outOfHomeWarning == true);

					this.consolesId.push(id);
					this.consolesName.push(name);
					this.consolesLocale.push(locale);
					this.consolesRegion.push(region);
					this.consolesConsoleType.push(consoleType);
					this.consolesPowerState.push(powerState);
					this.consolesDigitalAssistantRemoteControlEnabled.push(digitalAssistantRemoteControlEnabled);
					this.consolesRemoteManagementEnabled.push(remoteManagementEnabled);
					this.consolesConsoleStreamingEnabled.push(consoleStreamingEnabled);
					this.consolesWirelessWarning.push(wirelessWarning);
					this.consolesOutOfHomeWarning.push(outOfHomeWarning);

					const consolesStorageDevicesCount = consolesListData[i].storageDevices.length;
					for (let j = 0; j < consolesStorageDevicesCount; j++) {
						const storageDeviceId = consolesListData[i].storageDevices[j].storageDeviceId;
						const storageDeviceName = consolesListData[i].storageDevices[j].storageDeviceName;
						const isDefault = (consolesListData[i].storageDevices[j].isDefault == true);
						const freeSpaceBytes = consolesListData[i].storageDevices[j].freeSpaceBytes;
						const totalSpaceBytes = consolesListData[i].storageDevices[j].totalSpaceBytes;
						const isGen9Compatible = consolesListData[i].storageDevices[j].isGen9Compatible;

						this.consolesStorageDeviceId.push(storageDeviceId);
						this.consolesStorageDeviceName.push(storageDeviceName);
						this.consolesIsDefault.push(isDefault);
						this.consolesFreeSpaceBytes.push(freeSpaceBytes);
						this.consolesTotalSpaceBytes.push(totalSpaceBytes);
						this.consolesIsGen9Compatible.push(isGen9Compatible);
					}
				}
				resolve(true);
			} catch (error) {
				reject(error);
				this.log.error('Device: %s %s, get Consoles List error: %s.', this.host, this.name, error);
			};
		});
	}

	getWebApiUserProfile() {
		return new Promise(async (resolve, reject) => {
			this.log.debug('Device: %s %s, requesting web api user profile.', this.host, this.name);
			try {
				const getUserProfileData = await this.xboxWebApi.getProvider('profile').getUserProfile();
				const debug = this.enableDebugMode ? this.log('Device: %s %s, debug getUserProfileData, result: %s', this.host, this.name, getUserProfileData.profileUsers[0], getUserProfileData.profileUsers[0].settings[0]) : false;
				const userProfileData = getUserProfileData.profileUsers;

				this.userProfileId = new Array();
				this.userProfileHostId = new Array();
				this.userProfileIsSponsoredUser = new Array();

				this.userProfileSettingsId = new Array();
				this.userProfileSettingsValue = new Array();

				const profileUsersCount = userProfileData.length;
				for (let i = 0; i < profileUsersCount; i++) {
					const id = userProfileData[i].id;
					const hostId = userProfileData[i].hostId;
					const isSponsoredUser = userProfileData[i].isSponsoredUser;

					this.userProfileId.push(id);
					this.userProfileHostId.push(hostId);
					this.userProfileIsSponsoredUser.push(isSponsoredUser);

					const profileUsersSettingsCount = userProfileData[i].settings.length;
					for (let j = 0; j < profileUsersSettingsCount; j++) {
						const id = userProfileData[i].settings[j].id;
						const value = userProfileData[i].settings[j].value;

						this.userProfileSettingsId.push(id);
						this.userProfileSettingsValue.push(value);
					};
				};
				resolve(true);
			} catch (error) {
				reject(error);
				this.log.error('Device: %s %s, get User Profile error: %s.', this.host, this.name, error);
			};
		});
	}

	getWebApiInstalledApps() {
		return new Promise(async (resolve, reject) => {
			this.log.debug('Device: %s %s, requesting installed apps from your Xbox Live account.', this.host, this.name);
			try {
				const getInstalledAppsData = await this.xboxWebApi.getProvider('smartglass').getInstalledApps(this.xboxLiveId);
				const debug = this.enableDebugMode ? this.log('Device: %s %s, debug getInstalledAppsData: %s', this.host, this.name, getInstalledAppsData.result) : false;

				const inputsArr = new Array();
				const defaultInputsCount = DEFAULT_INPUTS.length;
				for (let i = 0; i < defaultInputsCount; i++) {
					inputsArr.push(DEFAULT_INPUTS[i]);
				};

				//get installed inputs/apps from web
				const inputsData = getInstalledAppsData.result;
				const inputsCount = inputsData.length;
				for (let i = 0; i < inputsCount; i++) {
					const oneStoreProductId = inputsData[i].oneStoreProductId;
					const titleId = inputsData[i].titleId;
					const aumid = inputsData[i].aumid;
					const lastActiveTime = inputsData[i].lastActiveTime;
					const isGame = (inputsData[i].isGame == true);
					const name = inputsData[i].name;
					const contentType = inputsData[i].contentType;
					const instanceId = inputsData[i].instanceId;
					const storageDeviceId = inputsData[i].storageDeviceId;
					const uniqueId = inputsData[i].uniqueId;
					const legacyProductId = inputsData[i].legacyProductId;
					const version = inputsData[i].version;
					const sizeInBytes = inputsData[i].sizeInBytes;
					const installTime = inputsData[i].installTime;
					const updateTime = inputsData[i].updateTime;
					const parentId = inputsData[i].parentId;
					const type = 'APPLICATION';

					const inputsObj = {
						'name': name,
						'titleId': titleId,
						'reference': aumid,
						'oneStoreProductId': oneStoreProductId,
						'type': type,
						'contentType': contentType
					};
					inputsArr.push(inputsObj);
				};
				const obj = JSON.stringify(inputsArr, null, 2);
				const writeInputs = await fsPromises.writeFile(this.inputsFile, obj);
				const debug1 = this.enableDebugMode ? this.log('Device: %s %s, saved inputs/apps list: %s', this.host, this.name, obj) : false;
				resolve(true);
			} catch (error) {
				reject(error);
				this.log.error('Device: %s %s, with liveId: %s, get Installed Apps error: %s.', this.host, this.name, this.xboxLiveId, error);
			};
		});
	}

	getWebApiStorageDevices() {
		return new Promise(async (resolve, reject) => {
			this.log.debug('Device: %s %s, requesting web api storage devices.', this.host, this.name);
			try {
				const getStorageDevicesData = await this.xboxWebApi.getProvider('smartglass').getStorageDevices(this.xboxLiveId);
				const debug = this.enableDebugMode ? this.log('Device: %s %s, debug getStorageDevicesData, result: %s', this.host, this.name, getStorageDevicesData) : false;

				const storageDeviceData = getStorageDevicesData.result;
				const deviceId = getStorageDevicesData.deviceId;
				const agentUserId = getStorageDevicesData.agentUserId;

				this.storageDeviceId = new Array();
				this.storageDeviceName = new Array();
				this.isDefault = new Array();
				this.freeSpaceBytes = new Array();
				this.totalSpaceBytes = new Array();
				this.isGen9Compatible = new Array();

				const storageDevicesCount = storageDeviceData.length;
				for (let i = 0; i < storageDevicesCount; i++) {
					const storageDeviceId = storageDeviceData[i].storageDeviceId;
					const storageDeviceName = storageDeviceData[i].storageDeviceName;
					const isDefault = (storageDeviceData[i].isDefault == true);
					const freeSpaceBytes = storageDeviceData[i].freeSpaceBytes;
					const totalSpaceBytes = storageDeviceData[i].totalSpaceBytes;
					const isGen9Compatible = storageDeviceData[i].isGen9Compatible;

					this.storageDeviceId.push(storageDeviceId);
					this.storageDeviceName.push(storageDeviceName);
					this.isDefault.push(isDefault);
					this.freeSpaceBytes.push(freeSpaceBytes);
					this.totalSpaceBytes.push(totalSpaceBytes);
					this.isGen9Compatible.push(isGen9Compatible);
				};
				resolve(true);
			} catch (error) {
				reject(error);
				this.log.error('Device: %s %s, with liveId: %s, get Storage Devices error: %s.', this.host, this.name, this.xboxLiveId, error);
			};
		});
	}

	getWebApiConsoleStatus() {
		return new Promise(async (resolve, reject) => {
			this.log.debug('Device: %s %s, requesting device info from Web API.', this.host, this.name);
			try {
				const getConsoleStatusData = await this.xboxWebApi.getProvider('smartglass').getConsoleStatus(this.xboxLiveId);
				const debug = this.enableDebugMode ? this.log('Device: %s %s, debug getConsoleStatusData, result: %s', this.host, this.name, getConsoleStatusData) : false;
				const consoleStatusData = getConsoleStatusData;

				const id = consoleStatusData.id;
				const name = consoleStatusData.name;
				const locale = consoleStatusData.locale;
				const region = consoleStatusData.region;
				const consoleType = CONSOLES_NAME[consoleStatusData.consoleType];
				const powerState = (CONSOLE_POWER_STATE[consoleStatusData.powerState] == 1); // 0 - Off, 1 - On, 2 - InStandby, 3 - SystemUpdate
				const playbackState = (CONSOLE_PLAYBACK_STATE[consoleStatusData.playbackState] == 1); // 0 - Stopped, 1 - Playng, 2 - Paused
				const loginState = consoleStatusData.loginState;
				const focusAppAumid = consoleStatusData.focusAppAumid;
				const isTvConfigured = (consoleStatusData.isTvConfigured == true);
				const digitalAssistantRemoteControlEnabled = (consoleStatusData.digitalAssistantRemoteControlEnabled == true);
				const consoleStreamingEnabled = (consoleStatusData.consoleStreamingEnabled == true);
				const remoteManagementEnabled = (consoleStatusData.remoteManagementEnabled == true);

				//this.serialNumber = id;
				this.modelName = consoleType;
				//this.powerState = powerState;
				//this.mediaState = playbackState;
				resolve(true);
			} catch (error) {
				reject(error);
				this.log.error('Device: %s %s, with liveId: %s, get Console Status error: %s.', this.host, this.name, this.xboxLiveId, error);
			};
		});
	}

	//Prepare accessory
	async prepareAccessory() {
		this.log.debug('prepareAccessory');
		const accessoryName = this.name;
		const accessoryUUID = UUID.generate(this.xboxLiveId);
		const accessoryCategory = Categories.TV_SET_TOP_BOX;
		const accessory = new Accessory(accessoryName, accessoryUUID, accessoryCategory);
		accessory.context.device = this.config.device;

		//Prepare information service
		this.log.debug('prepareInformationService');
		try {
			const readDevInfo = await fsPromises.readFile(this.devInfoFile);
			const devInfo = JSON.parse(readDevInfo);
			const debug = this.enableDebugMode ? this.log('Device: %s %s, debug devInfo: %s', this.host, accessoryName, devInfo) : false;

			const manufacturer = devInfo.manufacturer;
			const modelName = devInfo.modelName;
			const serialNumber = devInfo.serialNumber;
			const firmwareRevision = devInfo.firmwareRevision;

			accessory.removeService(accessory.getService(Service.AccessoryInformation));
			const informationService = new Service.AccessoryInformation(accessoryName);
			informationService
				.setCharacteristic(Characteristic.Manufacturer, manufacturer)
				.setCharacteristic(Characteristic.Model, modelName)
				.setCharacteristic(Characteristic.SerialNumber, serialNumber)
				.setCharacteristic(Characteristic.FirmwareRevision, firmwareRevision);
			accessory.addService(informationService);
		} catch (error) {
			this.log.error('Device: %s %s, prepareInformationService error: %s', this.host, accessoryName, error);
		};


		//Prepare television service
		this.log.debug('prepareTelevisionService');
		this.televisionService = new Service.Television(`${accessoryName} Television`, 'Television');
		this.televisionService.setCharacteristic(Characteristic.ConfiguredName, accessoryName);
		this.televisionService.setCharacteristic(Characteristic.SleepDiscoveryMode, Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);

		this.televisionService.getCharacteristic(Characteristic.Active)
			.onGet(async () => {
				const state = this.powerState;
				const logInfo = this.disableLogInfo ? false : this.log('Device: %s %s, get Power state successful: %s', this.host, accessoryName, state ? 'ON' : 'OFF');
				return state;
			})
			.onSet(async (state) => {
				try {
					//const setPower = this.webApiEnabled ? (!this.powerState && state) ? await this.xboxWebApi.getProvider('smartglass').powerOn(this.xboxLiveId) : (this.powerState && !state) ? this.xboxWebApi.getProvider('smartglass').powerOff(this.xboxLiveId) : false : false;
					const setPower = (!this.powerState && state) ? await this.xbox.powerOn() : (this.powerState && !state) ? await this.xbox.powerOff() : false;
					this.powerState = (this.powerState != state) ? state : this.powerState;
					const logInfo = this.disableLogInfo ? false : this.log('Device: %s %s, set Power successful, %s', this.host, accessoryName, state ? 'ON' : 'OFF');
				} catch (error) {
					this.log.error('Device: %s %s, set Power, error: %s', this.host, accessoryName, error);
				};
			});

		this.televisionService.getCharacteristic(Characteristic.ActiveIdentifier)
			.onGet(async () => {
				const inputIdentifier = this.inputIdentifier;
				const inputName = this.inputsName[inputIdentifier];
				const inputReference = this.inputsReference[inputIdentifier];
				const inputOneStoreProductId = this.inputsOneStoreProductId[inputIdentifier];
				const logInfo = this.disableLogInfo ? false : this.log('Device: %s %s, get Input successful, input: %s, reference: %s, product Id: %s', this.host, accessoryName, inputName, inputReference, inputOneStoreProductId);
				return inputIdentifier;
			})
			.onSet(async (inputIdentifier) => {
				const inputName = this.inputsName[inputIdentifier];
				const inputReference = this.inputsReference[inputIdentifier];
				const inputOneStoreProductId = this.inputsOneStoreProductId[inputIdentifier];
				const setDashboard = (inputOneStoreProductId === 'Dashboard' || inputOneStoreProductId === 'Settings' || inputOneStoreProductId === 'SettingsTv' || inputOneStoreProductId === 'Accessory' || inputOneStoreProductId === 'Screensaver' || inputOneStoreProductId === 'NetworkTroubleshooter');
				const setTelevision = (inputOneStoreProductId === 'Television');
				const setApp = ((inputOneStoreProductId != undefined && inputOneStoreProductId != '0') && !setDashboard && !setTelevision);
				try {
					const setInput = (this.webApiEnabled) ? setApp ? await this.xboxWebApi.getProvider('smartglass').launchApp(this.xboxLiveId, inputOneStoreProductId) : setDashboard ? await this.xboxWebApi.getProvider('smartglass').launchDashboard(this.xboxLiveId) : setTelevision ? await this.xboxWebApi.getProvider('smartglass').launchOneGuide(this.xboxLiveId) : false : false;
					const logInfo = this.disableLogInfo ? false : this.log('Device: %s %s, set Input successful, input: %s, reference: %s, product Id: %s', this.host, accessoryName, inputName, inputReference, inputOneStoreProductId);
					this.inputIdentifier = inputIdentifier;
				} catch (error) {
					this.log.error('Device: %s %s, set Input error: %s', this.host, accessoryName, error);
				};
			});

		this.televisionService.getCharacteristic(Characteristic.RemoteKey)
			.onSet(async (command) => {
				let channelName;
				switch (command) {
					case Characteristic.RemoteKey.REWIND:
						command = 'rewind';
						channelName = 'systemMedia';
						break;
					case Characteristic.RemoteKey.FAST_FORWARD:
						command = 'fastForward';
						channelName = 'systemMedia';
						break;
					case Characteristic.RemoteKey.NEXT_TRACK:
						command = 'nextTrack';
						channelName = 'systemMedia';
						break;
					case Characteristic.RemoteKey.PREVIOUS_TRACK:
						command = 'prevTrack';
						channelName = 'systemMedia';
						break;
					case Characteristic.RemoteKey.ARROW_UP:
						command = 'up';
						channelName = 'systemInput';
						break;
					case Characteristic.RemoteKey.ARROW_DOWN:
						command = 'down';
						channelName = 'systemInput';
						break;
					case Characteristic.RemoteKey.ARROW_LEFT:
						command = 'left';
						channelName = 'systemInput';
						break;
					case Characteristic.RemoteKey.ARROW_RIGHT:
						command = 'right';
						channelName = 'systemInput';
						break;
					case Characteristic.RemoteKey.SELECT:
						command = 'a';
						channelName = 'systemInput';
						break;
					case Characteristic.RemoteKey.BACK:
						command = 'b';
						channelName = 'systemInput';
						break;
					case Characteristic.RemoteKey.EXIT:
						command = 'nexus';
						channelName = 'systemInput';
						break;
					case Characteristic.RemoteKey.PLAY_PAUSE:
						command = 'playpause';
						channelName = 'systemMedia';
						break;
					case Characteristic.RemoteKey.INFORMATION:
						command = this.infoButtonCommand;
						channelName = 'systemInput';
						break;
				};
				try {
					const sendCommand = this.powerState ? this.webApiEnabled ? await this.xboxWebApi.getProvider('smartglass').sendButtonPress(this.xboxLiveId, command) : await this.xbox.sendCommand(channelName, command) : false;
					const logInfo = this.disableLogInfo ? false : this.log('Device: %s %s, Remote Key command successful: %s', this.host, accessoryName, command);
				} catch (error) {
					this.log.error('Device: %s %s, set Remote Key command error: %s', this.host, accessoryName, error);
				};
			});

		this.televisionService.getCharacteristic(Characteristic.CurrentMediaState)
			.onGet(async () => {
				//apple, 0 - PLAY, 1 - PAUSE, 2 - STOP, 3 - LOADING, 4 - INTERRUPTED
				//xbox, 0 - STOP, 1 - PLAY, 2 - PAUSE
				const value = [2, 0, 1, 3, 4][this.mediaState];
				const logInfo = this.disableLogInfo ? false : this.log('Device: %s %s, get Current Media state successful: %s', this.host, accessoryName, ['PLAY', 'PAUSE', 'STOP', 'LOADING', 'INTERRUPTED'][value]);
				return value;
			});

		this.televisionService.getCharacteristic(Characteristic.TargetMediaState)
			.onGet(async () => {
				//0 - PLAY, 1 - PAUSE, 2 - STOP
				const value = [2, 0, 1, 3, 4][this.mediaState];
				const logInfo = this.disableLogInfo ? false : this.log('Device: %s %s, get Target Media state successful: %s', this.host, accessoryName, ['PLAY', 'PAUSE', 'STOP', 'LOADING', 'INTERRUPTED'][value]);
				return value;
			})
			.onSet(async (value) => {
				try {
					const newMediaState = value;
					const setMediaState = this.powerState ? false : false;
					const logInfo = this.disableLogInfo ? false : this.log('Device: %s %s, set Target Media state successful: %s', this.host, accessoryName, ['PLAY', 'PAUSE', 'STOP', 'LOADING', 'INTERRUPTED'][value]);
				} catch (error) {
					this.log.error('Device: %s %s %s, set Target Media state error: %s', this.host, accessoryName, error);
				};
			});

		this.televisionService.getCharacteristic(Characteristic.PowerModeSelection)
			.onSet(async (command) => {
				switch (command) {
					case Characteristic.PowerModeSelection.SHOW:
						command = 'nexus';
						break;
					case Characteristic.PowerModeSelection.HIDE:
						command = 'b';
						break;
				};
				try {
					const channelName = 'systemInput';
					const setPowerModeSelection = this.powerState ? this.webApiEnabled ? await this.xboxWebApi.getProvider('smartglass').sendButtonPress(this.xboxLiveId, command) : await this.xbox.sendCommand(channelName, command) : false;
					const logInfo = this.disableLogInfo ? false : this.log('Device: %s %s, set Power Mode Selection command successful: %s', this.host, accessoryName, command);
				} catch (error) {
					this.log.error('Device: %s %s, set Power Mode Selection command error: %s', this.host, accessoryName, error);
				};
			});

		accessory.addService(this.televisionService);

		//Prepare speaker service
		this.log.debug('prepareSpeakerService');
		this.speakerService = new Service.TelevisionSpeaker(`${accessoryName} Speaker`, 'Speaker');
		this.speakerService
			.setCharacteristic(Characteristic.Active, Characteristic.Active.ACTIVE)
			.setCharacteristic(Characteristic.VolumeControlType, Characteristic.VolumeControlType.ABSOLUTE)
			.getCharacteristic(Characteristic.VolumeSelector)
			.onSet(async (command) => {
				switch (command) {
					case Characteristic.VolumeSelector.INCREMENT:
						command = 'volUp';
						break;
					case Characteristic.VolumeSelector.DECREMENT:
						command = 'volDown';
						break;
				};
				try {
					const channelName = 'tvRemote';
					const setVolume = (this.powerState && this.webApiEnabled) ? await this.xboxWebApi.getProvider('smartglass').sendButtonPress(this.xboxLiveId, command) : false;
					const logInfo = this.disableLogInfo ? false : this.log('Device: %s %s, set Volume command successful: %s', this.host, accessoryName, command);
				} catch (error) {
					this.log.error('Device: %s %s, set Volume command error: %s', this.host, accessoryName, error);
				};
			});

		this.speakerService.getCharacteristic(Characteristic.Volume)
			.onGet(async () => {
				const volume = this.volume;
				const logInfo = this.disableLogInfo ? false : this.log('Device: %s %s, get Volume successful: %s', this.host, accessoryName, volume);
				return volume;
			})
			.onSet(async (volume) => {
				if (volume == 0 || volume == 100) {
					volume = this.volume;
				};
				const logInfo = this.disableLogInfo ? false : this.log('Device: %s %s, set Volume successful: %s', this.host, accessoryName, volume);
			});

		this.speakerService.getCharacteristic(Characteristic.Mute)
			.onGet(async () => {
				const state = this.muteState;
				const logInfo = this.disableLogInfo ? false : this.log('Device: %s %s, get Mute successful: %s', this.host, accessoryName, state ? 'ON' : 'OFF');
				return state;
			})
			.onSet(async (state) => {
				try {
					const toggleMute = (this.powerState && this.webApiEnabled) ? state ? await this.xboxWebApi.getProvider('smartglass').mute(this.xboxLiveId) : await this.xboxWebApi.getProvider('smartglass').unmute(this.xboxLiveId) : false;
					const logInfo = this.disableLogInfo ? false : this.log('Device: %s %s, set Mute successful: %s', this.host, accessoryName, state ? 'ON' : 'OFF');
				} catch (error) {
					this.log.error('Device: %s %s, set Mute error: %s', this.host, accessoryName, error);
				};
			});

		accessory.addService(this.speakerService);

		//Prepare volume service
		if (this.volumeControl >= 1) {
			this.log.debug('prepareVolumeService');
			if (this.volumeControl == 1) {
				this.volumeService = new Service.Lightbulb(`${accessoryName} Volume`, 'Volume');
				this.volumeService.getCharacteristic(Characteristic.Brightness)
					.onGet(async () => {
						const volume = this.volume;
						return volume;
					})
					.onSet(async (volume) => {
						const setVolume = this.powerState ? this.speakerService.setCharacteristic(Characteristic.Volume, volume) : false;
					});
				this.volumeService.getCharacteristic(Characteristic.On)
					.onGet(async () => {
						const state = !this.muteState;
						return state;
					})
					.onSet(async (state) => {
						const setMute = this.powerState ? this.speakerService.setCharacteristic(Characteristic.Mute, !state) : false;
					});

				accessory.addService(this.volumeService);
			}

			if (this.volumeControl == 2) {
				this.volumeServiceFan = new Service.Fan(`${accessoryName} Volume`, 'Volume');
				this.volumeServiceFan.getCharacteristic(Characteristic.RotationSpeed)
					.onGet(async () => {
						const volume = this.volume;
						return volume;
					})
					.onSet(async (volume) => {
						const setVolume = this.powerState ? this.speakerService.setCharacteristic(Characteristic.Volume, volume) : false;
					});
				this.volumeServiceFan.getCharacteristic(Characteristic.On)
					.onGet(async () => {
						const state = !this.muteState;
						return state;
					})
					.onSet(async (state) => {
						const setMute = this.powerState ? this.speakerService.setCharacteristic(Characteristic.Mute, !state) : false;
					});

				accessory.addService(this.volumeServiceFan);
			}
		}

		//Prepare inputs services
		this.log.debug('prepareInputServices');

		const savedInputs = ((fs.readFileSync(this.inputsFile)).length > 0) ? JSON.parse(fs.readFileSync(this.inputsFile)) : [];
		const debug = this.enableDebugMode ? this.log('Device: %s %s, read saved Inputs successful, inpits: %s', this.host, accessoryName, savedInputs) : false;

		const savedInputsNames = ((fs.readFileSync(this.inputsNamesFile)).length > 0) ? JSON.parse(fs.readFileSync(this.inputsNamesFile)) : {};
		const debug1 = this.enableDebugMode ? this.log('Device: %s %s, read saved custom Inputs Names successful, names: %s', this.host, accessoryName, savedInputsNames) : false;

		const savedTargetVisibility = ((fs.readFileSync(this.inputsTargetVisibilityFile)).length > 0) ? JSON.parse(fs.readFileSync(this.inputsTargetVisibilityFile)) : {};
		const debug2 = this.enableDebugMode ? this.log('Device: %s %s, read saved Target Visibility successful, states %s', this.host, accessoryName, savedTargetVisibility) : false;

		//check available inputs and filter costom inputs
		const allInputs = (this.getInputsFromDevice && savedInputs.length > 0) ? savedInputs : this.inputs;
		const inputsArr = new Array();
		const allInputsCount = allInputs.length;
		for (let i = 0; i < allInputsCount; i++) {
			const contentType = allInputs[i].contentType;
			const filterGames = this.filterGames ? (contentType != 'Game') : true;
			const filterApps = this.filterApps ? (contentType != 'App') : true;
			const filterSystemApps = this.filterSystemApps ? (contentType != 'systemApp') : true;
			const filterDlc = this.filterDlc ? (contentType != 'Dlc') : true;
			const push = (this.getInputsFromDevice) ? (filterGames && filterApps && filterSystemApps && filterDlc) ? inputsArr.push(allInputs[i]) : false : inputsArr.push(allInputs[i]);
		}

		//check available inputs and possible inputs count (max 93)
		const inputs = inputsArr;
		const inputsCount = inputs.length;
		const maxInputsCount = (inputsCount < 93) ? inputsCount : 93;
		for (let j = 0; j < maxInputsCount; j++) {

			//get title Id
			const inputTitleId = (inputs[j].titleId != undefined) ? inputs[j].titleId : undefined;

			//get input reference
			const inputReference = (inputs[j].reference != undefined) ? inputs[j].reference : undefined;

			//get input oneStoreProductId
			const inputOneStoreProductId = (inputs[j].oneStoreProductId != undefined) ? inputs[j].oneStoreProductId : undefined;

			//get input name
			const inputName = (savedInputsNames[inputTitleId] != undefined) ? savedInputsNames[inputTitleId] : (savedInputsNames[inputReference] != undefined) ? savedInputsNames[inputReference] : (savedInputsNames[inputOneStoreProductId] != undefined) ? savedInputsNames[inputOneStoreProductId] : inputs[j].name;

			//get input type
			const inputType = (inputs[j].type != undefined) ? INPUT_SOURCE_TYPES.indexOf(inputs[j].type) : 10;

			//get input configured
			const isConfigured = 1;

			//get input visibility state
			const currentVisibility = (savedTargetVisibility[inputTitleId] != undefined) ? savedTargetVisibility[inputTitleId] : (savedTargetVisibility[inputReference] != undefined) ? savedTargetVisibility[inputReference] : (savedTargetVisibility[inputOneStoreProductId] != undefined) ? savedTargetVisibility[inputOneStoreProductId] : 0;
			const targetVisibility = currentVisibility;

			const inputService = new Service.InputSource(inputName, `Input ${j}`);
			inputService
				.setCharacteristic(Characteristic.Identifier, j)
				.setCharacteristic(Characteristic.ConfiguredName, inputName)
				.setCharacteristic(Characteristic.IsConfigured, isConfigured)
				.setCharacteristic(Characteristic.InputSourceType, inputType)
				.setCharacteristic(Characteristic.CurrentVisibilityState, currentVisibility)
				.setCharacteristic(Characteristic.TargetVisibilityState, targetVisibility);

			inputService
				.getCharacteristic(Characteristic.ConfiguredName)
				.onSet(async (name) => {
					const nameIdentifier = (inputTitleId != undefined) ? inputTitleId : (inputReference != undefined) ? inputReference : (inputOneStoreProductId != undefined) ? inputOneStoreProductId : false;
					let newName = savedInputsNames;
					newName[nameIdentifier] = name;
					const newCustomName = JSON.stringify(newName);
					try {
						const writeNewCustomName = (nameIdentifier != false) ? await fsPromises.writeFile(this.inputsNamesFile, newCustomName) : false;
						const logInfo = this.disableLogInfo ? false : this.log('Device: %s %s, saved new Input name successful, name: %s, product Id: %s', this.host, accessoryName, newCustomName, inputOneStoreProductId);
					} catch (error) {
						this.log.error('Device: %s %s, saved new Input Name error: %s', this.host, accessoryName, error);
					}
				});

			inputService
				.getCharacteristic(Characteristic.TargetVisibilityState)
				.onSet(async (state) => {
					const targetVisibilityIdentifier = (inputTitleId != undefined) ? inputTitleId : (inputReference != undefined) ? inputReference : (inputOneStoreProductId != undefined) ? inputOneStoreProductId : false;
					let newState = savedTargetVisibility;
					newState[targetVisibilityIdentifier] = state;
					const newTargetVisibility = JSON.stringify(newState);
					try {
						const writeNewTargetVisibility = (targetVisibilityIdentifier != false) ? await fsPromises.writeFile(this.inputsTargetVisibilityFile, newTargetVisibility) : false;
						const logInfo = this.disableLogInfo ? false : this.log('Device: %s %s, saved new Target Visibility successful, input: %s, state: %s', this.host, accessoryName, inputName, state ? 'HIDEN' : 'SHOWN');
						inputService.setCharacteristic(Characteristic.CurrentVisibilityState, state);
					} catch (error) {
						this.log.error('Device: %s %s, saved new Target Visibility error, input: %s, error: %s', this.host, accessoryName, inputName, error);
					}
				});

			this.inputsTitleId.push(inputTitleId);
			this.inputsReference.push(inputReference);
			this.inputsOneStoreProductId.push(inputOneStoreProductId);
			this.inputsName.push(inputName);
			this.inputsType.push(inputType);

			this.televisionService.addLinkedService(inputService);
			accessory.addService(inputService);
		}

		//Prepare buttons services
		//check available buttons and possible buttons count (max 94)
		const buttons = this.buttons;
		const buttonsCount = buttons.length;
		const availableButtonshCount = 94 - maxInputsCount;
		const maxButtonsCount = (availableButtonshCount > 0) ? (availableButtonshCount >= buttonsCount) ? buttonsCount : availableButtonshCount : 0;
		if (maxButtonsCount > 0) {
			this.log.debug('prepareButtonServices');
			for (let i = 0; i < maxButtonsCount; i++) {

				//get button command
				const buttonCommand = (buttons[i].command != undefined) ? buttons[i].command : '';

				//get button name
				const buttonName = (buttons[i].name != undefined) ? buttons[i].name : buttonCommand;

				//get button display type
				const buttonDisplayType = (buttons[i].displayType != undefined) ? buttons[i].displayType : 0;

				//get button mode
				let buttonMode = 0;
				let channelName = '';
				let command = '';
				if (buttonCommand in SYSTEM_MEDIA_COMMANDS) {
					buttonMode = 0;
					channelName = 'systemMedia';
					command = buttonCommand;
				} else if (buttonCommand in SYSTEM_INPUTS_COMMANDS) {
					buttonMode = 1;
					channelName = 'systemInput';
					command = buttonCommand;
				} else if (buttonCommand in TV_REMOTE_COMMANDS) {
					buttonMode = 2;
					channelName = 'tvRemote';
				} else if (buttonCommand === 'recordGameDvr') {
					buttonMode = 3;
					command = buttonCommand;
				} else if (buttonCommand === 'reboot') {
					buttonMode = 4;
				} else if (buttonCommand === 'switchAppGame') {
					buttonMode = 5;
				};

				//get button inputOneStoreProductId
				const buttonOneStoreProductId = (buttons[i].oneStoreProductId != undefined) ? buttons[i].oneStoreProductId : '0';

				const serviceType = [Service.Outlet, Service.Switch][buttonDisplayType];
				const buttonService = new serviceType(`${accessoryName} ${buttonName}`, `Button ${i}`);
				buttonService.getCharacteristic(Characteristic.On)
					.onGet(async () => {
						const state = false;
						const logInfo = this.disableLogInfo ? false : this.log('Device: %s %s, get Button state successful: %s', this.host, accessoryName, state);
						return state;
					})
					.onSet(async (state) => {
						const setDashboard = (buttonOneStoreProductId === 'Dashboard' || buttonOneStoreProductId === 'Settings' || buttonOneStoreProductId === 'SettingsTv' || buttonOneStoreProductId === 'Accessory' || buttonOneStoreProductId === 'Screensaver' || buttonOneStoreProductId === 'NetworkTroubleshooter');
						const setTelevision = (buttonOneStoreProductId === 'Television');
						const setApp = ((buttonOneStoreProductId != undefined && buttonOneStoreProductId != '0') && !setDashboard && !setTelevision);
						try {
							const setCommand = (this.powerState && state && this.webApiEnabled && buttonMode <= 2) ? await this.xboxWebApi.getProvider('smartglass').sendButtonPress(this.xboxLiveId, command) : false
							const recordGameDvr = (this.powerState && state && buttonMode == 3) ? await this.xbox.recordGameDvr() : false;
							const rebootConsole = (this.powerState && state && this.webApiEnabled && buttonMode == 4) ? await this.xboxWebApi.getProvider('smartglass').reboot(this.xboxLiveId) : false;
							const setAppInput = (this.powerState && state && this.webApiEnabled && buttonMode == 5) ? setApp ? await this.xboxWebApi.getProvider('smartglass').launchApp(this.xboxLiveId, buttonOneStoreProductId) : setDashboard ? await this.xboxWebApi.getProvider('smartglass').launchDashboard(this.xboxLiveId) : setTelevision ? await this.xboxWebApi.getProvider('smartglass').launchOneGuide(this.xboxLiveId) : false : false;
							const logInfo = this.disableLogInfo ? false : this.log('Device: %s %s, set button successful, name: %s, command: %s', this.host, accessoryName, buttonName, buttonCommand);
						} catch (error) {
							this.log.error('Device: %s %s, set button error, name: %s, error: %s', this.host, accessoryName, buttonName, error);
						};
						setTimeout(() => {
							buttonService.updateCharacteristic(Characteristic.On, false);
						}, 200);
					});
				accessory.addService(buttonService);
			}
		}

		const debug3 = this.enableDebugMode ? this.log('Device: %s %s, publishExternalAccessory.', this.host, accessoryName) : false;
		this.api.publishExternalAccessories(PLUGIN_NAME, [accessory]);
	}
};

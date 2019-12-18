"use strict";

const utils = require('./utils')
const Droid = require('./droid');

const CONNECT_SERVICE = "00020001574f4f2053706865726f2121";
const CONNECT_CHAR = "00020005574f4f2053706865726f2121";
const SPECIAL_SERVICE = "00010001574f4f2053706865726f2121";
const SPECIAL_CHAR = "00010002574f4f2053706865726f2121";

const MSG_CONNECTION = [0x75,0x73,0x65,0x74,0x68,0x65,0x66,0x6F,0x72,0x63,0x65,0x2E,0x2E,0x2E,0x62,0x61,0x6E,0x64];
const MSG_INIT = [0x0A,0x13,0x0D];
const MSG_ROTATE = [0x0A,0x17,0x0F]; //0x42,0xB4,0x00,0x00 //0x00,0x00,0x00,0x00
const MSG_ANIMATION = [0x0A,0x17,0x05];
const MSG_CARRIAGE = [0x0A, 0x17, 0x0D];
const MSG_OFF = [0x0A,0x13,0x01];


const ESC = 0xAB; // 171
const SOP = 0x8D; // 141
const EOP = 0xD8; // 216
const ESC_ESC = 0x23;
const ESC_SOP = 0x05;
const ESC_EOP = 0x50;


class R2D2 extends Droid {

    constructor (address=null) {
        super(address);
    }

    _encodePacketBody(payload) {
        let packetEncoded = [];
        for (let i = 0 ; i < payload.length ; i++) {
            if (payload[i] == ESC) {
                packetEncoded.push(...[ESC, ESC_ESC]);
            }
            else if (payload[i] == SOP) {
                packetEncoded.push(...[ESC, ESC_SOP]);
            }
            else if (payload[i] == EOP) {
                packetEncoded.push(...[ESC, ESC_EOP]);
            }
            else {
                packetEncoded.push(payload[i])
            }
        }
        return packetEncoded;
    }

    _buildPacket(init, payload=[]) {
        let packet = [SOP];
        let body = [];

        body.push(...init);
        body.push(this._seq);
        body.push(...payload);

        body.push(utils.calculateChk(body));

        packet.push(...this._encodePacketBody(body));

        packet.push(EOP);
        this._seq = (this._seq + 1) % 140;

        return packet;
    }

    _writePacket(characteristic, buff, waitForNotification=false, timeout=0) {
        return new Promise(function(resolve, reject) {
            let dataRead = [];

            let isAValidRequest = (dataRead) => {
                if (dataRead[5] != 0x00) {
                    return dataRead[5];
                }
                return 0x00;
            }

            let listenerF = (data, isNotification) => {
                dataRead.push(...data)
                if (data[data.length - 1] === EOP) {
                    // Check Package and Wait
                    if (waitForNotification) {
                        if (dataRead[1] % 2 == 0) {
                            setTimeout(() => {
                                resolve(true);
                            }, timeout);
                        } else {
                            let errorCode = isAValidRequest(dataRead);
                            if (errorCode != 0x00) {
                                reject(errorCode);
                            }
                        }
                    } else {
                        let errorCode = isAValidRequest(dataRead);
                        if (errorCode != 0x00) {
                            reject(errorCode);
                        }
                        setTimeout(() => {
                            resolve(true);
                        }, timeout);
                    }
                    dataRead = [];
                }
            };
            characteristic.removeAllListeners('data');
            characteristic.on('data', listenerF);
            characteristic.write(new Buffer(buff), true, (error) => {
            });

        });
    }

    // Used only for debug
    _general_mess(data, params=[], wait=false, timeout=0) {
        return this._writePacket(
            this._specialChar,
            this._buildPacket(data, params),
            wait,
            timeout
        );
    }

    connect() {
        return new Promise((resolve, reject) => {
            this._findPeripheral().then((peripheral) => {
                peripheral.connect( (e) => {
                    peripheral.discoverServices([CONNECT_SERVICE], (error, services) => {
                        services[0].discoverCharacteristics([CONNECT_CHAR], (error, characteristics) => {
                            this._connectChar = characteristics[0];
                            this._connectChar.write(new Buffer(MSG_CONNECTION), true, (error) => {
                                peripheral.discoverServices([SPECIAL_SERVICE], (error, services) => {
                                    services[0].discoverCharacteristics([SPECIAL_CHAR], (error, characteristics) => {
                                        this._specialChar = characteristics[0];
                                        this._specialChar.subscribe(error => {
                                            if (error) {
                                                console.error('Error subscribing to char.');
                                            }
                                        });
                                        this._writePacket(
                                            this._specialChar,
                                            this._buildPacket(MSG_INIT),
                                            true,
                                            5000
                                        ).then(() => {
                                            resolve(true);
                                        })
                                    });
                                });
                            });
                        });
                    });
                });
            });

        });
    }

    animate(animationId) {
        return this._writePacket(
            this._specialChar,
            this._buildPacket(MSG_ANIMATION, [0x00, animationId]),
            true
        );
    }

    _convertDegreeToHex(degree) {
        var view = new DataView(new ArrayBuffer(4));
        view.setFloat32(0, degree);
        return Array
            .apply(null, { length: 4 })
            .map((_, i) => view.getUint8(i))

    }

    rotateTop(degree) {
        return this._writePacket(
            this._specialChar,
            this._buildPacket(MSG_ROTATE, this._convertDegreeToHex(degree)),
            //this._buildPacket(MSG_ROTATE, [0xc2,0xb4,0x00,0x00]), //-90
            //this._buildPacket(MSG_ROTATE, [0xc2,0xf0,0x00,0x00]), //- 120
            //this._buildPacket(MSG_ROTATE, [0xc3,0x20,0x00,0x00]), //-160
            // this._buildPacket(MSG_ROTATE, [0xc3,0x2a,0x00,0x00]), //-170 ERRORE
            //this._buildPacket(MSG_ROTATE, [0x41,0xa0,0x00,0x00]), //20
            //this._buildPacket(MSG_ROTATE, [0x42,0xb2,0x00,0x00]), //89
            //this._buildPacket(MSG_ROTATE, [0x43,0x34,0x00,0x00]), //180
            //this._buildPacket(MSG_ROTATE, [0x43,0x35,0x00,0x00]), //181 ERRORE
            false,
        );
    }

    openCarriage() {
        return this._writePacket(
            this._specialChar,
            this._buildPacket(MSG_CARRIAGE, [0x01]),
            false,
            2000
        );
    }

    closeCarriage() {
        return this._writePacket(
            this._specialChar,
            this._buildPacket(MSG_CARRIAGE, [0x02]),
            false,
            2000
        );
    }

    off() {
        return this._writePacket(
            this._specialChar,
            this._buildPacket(MSG_OFF),
            true
        );
    }

};


module.exports = R2D2;

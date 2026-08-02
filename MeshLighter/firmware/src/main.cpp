#include "serial_interface.h"
#include "nvdata.h"
#include "picopb.h"

// include the library
#include <RadioLib.h>

//#define NUGGET_CONNECT
#if !defined(NIBBLE_ZERO)
#define NIBBLE_ZERO
#endif

#if defined(WIFI_LORA_32_V3)
#include "boards/heltec_v3.h"
#elif defined(WIFI_LORA_32_V4)
#include "boards/heltec_v4.h"
#elif defined(NUGGET_CONNECT)
#include "boards/nugget_connect.h"
#elif defined(NIBBLE_ZERO)
#include "boards/nibble_zero.h"
#else
#error unrecognized board
#endif


// flag to indicate that a packet was received
volatile bool receivedFlag = false;
volatile bool transmitFlag = false;

// this function is called when a complete packet
// is received by the module
// IMPORTANT: this function MUST be 'void' type
//            and MUST NOT have any arguments!
#if defined(ESP8266) || defined(ESP32)
IRAM_ATTR
#endif

void radioEvent(void)
{
  transmitFlag = true;
}

float freq = 906.875; //frequency
float bw = 250.0; //bandwidth
uint8_t sf = 11; //spread factor
uint8_t cr = 5; //coding rate
uint8_t syncWord=0x2B;
int8_t power=22;
uint16_t pl=16;

uint64_t led_off_time = 0;
uint64_t neopixel_off_time = 0;
int rx_count = 0;
int tx_count = 0;
bool radio_ok = false;   // set true only if the SX1262 initialises
volatile bool txPending = false;   // TX started -> emit ACK when done (flow control)
uint8_t ctrl_buf[64];              // scratch for control / ACK / scan frames

// Non-blocking presence check for the SX1262: reset, wait (bounded) for BUSY to
// fall, then read GetStatus. Prevents radio.begin() from hanging forever on a
// board that has no SX1262 at these pins (old firmware sat in while(true)).
static bool probe_radio() {
  pinMode(SS, OUTPUT);       digitalWrite(SS, HIGH);
  pinMode(RST_LoRa, OUTPUT);
  pinMode(BUSY_LoRa, INPUT);
  digitalWrite(RST_LoRa, LOW);  delay(2);
  digitalWrite(RST_LoRa, HIGH);
  uint32_t t0 = millis();
  while (digitalRead(BUSY_LoRa) == HIGH) {     // a present chip releases BUSY
    if (millis() - t0 > 100) return false;
    delay(1);
  }
  hspi.beginTransaction(SPISettings(2000000, MSBFIRST, SPI_MODE0));
  digitalWrite(SS, LOW);
  hspi.transfer(0xC0);                          // GetStatus opcode
  uint8_t st = hspi.transfer(0x00);
  digitalWrite(SS, HIGH);
  hspi.endTransaction();
  return (st != 0x00 && st != 0xFF);            // real chip -> plausible status
}

void update_display_counters() {
  #if defined(NIBBLE_ZERO)
  if(!oled_ok) return;
  u8g2.clearBuffer();
  u8g2.setCursor(0, 10);
  u8g2.print("lora-lite v1.0");
  u8g2.setCursor(0, 30);
  u8g2.printf("Freq: %.3f", freq);
  u8g2.setCursor(0, 45);
  u8g2.printf("RX: %d", rx_count);
  u8g2.setCursor(64, 45);
  u8g2.printf("TX: %d", tx_count);
  u8g2.sendBuffer();
  #endif
}

void mt_send(uint8_t *buff, int len)
{
  neopixelWrite(NEOPIXEL_PIN, 40, 0, 0);   // TX = red
  neopixel_off_time = millis() + 200;
  int16_t status = radio.startTransmit(buff,len);
  txPending = true;                 // TX in flight -> ACK on completion [#2]
  tx_count++;
  update_display_counters();
}

void display_status(const char* msg, int line) {
  #if defined(NIBBLE_ZERO)
  if(!oled_ok) return;
  u8g2.setCursor(0, line * 10 + 10);
  u8g2.print(msg);
  u8g2.sendBuffer();
  #endif
}

// ---- runtime radio control (invoked from serial_config in serial_interface.cpp) ----

// #3 apply PHY params (freq/bw/sf/cr/sync/power/pl) from NVDATA to the LIVE radio
// with no reboot -> instant channel / preset / power / private-channel switching.
void radio_apply_live() {
  if (!radio_ok) { Serial.println(F("apply-live: radio not ready")); return; }
  int l;
  l=4; nvdata.get("freq",(uint8_t*)&freq,&l);
  l=4; nvdata.get("bw",(uint8_t*)&bw,&l);
  l=1; nvdata.get("sf",(uint8_t*)&sf,&l);
  l=1; nvdata.get("cr",(uint8_t*)&cr,&l);
  l=1; nvdata.get("syncword",(uint8_t*)&syncWord,&l);
  l=1; nvdata.get("power",(uint8_t*)&power,&l);
  l=1; nvdata.get("pl",(uint8_t*)&pl,&l);
  radio.setFrequency(freq);
  radio.setBandwidth(bw);
  radio.setSpreadingFactor(sf);
  radio.setCodingRate(cr);
  radio.setSyncWord(syncWord);
  radio.setOutputPower(power);
  radio.setPreambleLength(pl);
  radio.startReceive();
  Serial.printf("apply-live: freq=%.3f bw=%.1f sf=%d cr=%d sync=0x%02x pwr=%d\n",
                freq, bw, sf, cr, syncWord, power);
  update_display_counters();
  picopb pb(ctrl_buf, sizeof(ctrl_buf)); pb.write_varint(1, 5);   // control-done ack
  serial_send(ctrl_buf, pb.get_length());
}

// #5 promiscuous sniff: choose the LoRa sync word (0x2B = Meshtastic, 0x12 =
// generic/public LoRa) and turn CRC off to also capture malformed frames.
void radio_set_sniff(uint8_t sync, bool crc) {
  if (!radio_ok) return;
  radio.setSyncWord(sync);
  radio.setCRC(crc);
  radio.startReceive();
  Serial.printf("sniff: sync=0x%02x crc=%d\n", sync, crc ? 1 : 0);
  picopb pb(ctrl_buf, sizeof(ctrl_buf)); pb.write_varint(1, 5);
  serial_send(ctrl_buf, pb.get_length());
}

// #6 spectrum sweep: hop start..end by step (kHz), report peak RSSI per channel,
// then restore normal Meshtastic RX. Frames: {1:4, 2:freq_khz, 3:rssi}, end {1:5}.
void radio_scan(uint32_t start_khz, uint32_t end_khz, uint32_t step_khz, uint32_t dwell_ms) {
  if (!radio_ok || step_khz == 0) return;
  Serial.printf("scan %lu-%lu khz step %lu dwell %lu\n",
                (unsigned long)start_khz,(unsigned long)end_khz,
                (unsigned long)step_khz,(unsigned long)dwell_ms);
  for (uint32_t f = start_khz; f <= end_khz; f += step_khz) {
    radio.setFrequency(f / 1000.0);
    radio.startReceive();
    float peak = -200.0;
    uint32_t t0 = millis();
    while (millis() - t0 < dwell_ms) {
      float r = radio.getRSSI(false);   // instantaneous channel RSSI
      if (r > peak) peak = r;
      delay(1);
    }
    picopb pb(ctrl_buf, sizeof(ctrl_buf));
    pb.write_varint(1, 4);
    pb.write_i32(2, f);
    pb.write_i32(3, (int)peak);
    serial_send(ctrl_buf, pb.get_length());
  }
  radio_apply_live();   // restore normal RX (also emits the {1:5} done ack)
}

void setup() {
  int len;
  Serial.begin(115200);
  pinMode(39, OUTPUT);
  for(int i=0; i<5; i++) {
    digitalWrite(39, HIGH); delay(100);
    digitalWrite(39, LOW); delay(100);
  }
  while(!Serial && millis() < 3000); // Wait for USB Serial
  delay(1000);
  Serial.printf("System init\n");
  board_init();
  display_status("lora-lite v1.0", 0);
  serial_init();
  pinMode(39,OUTPUT);
  nvdata.init("nvdata");
  display_status("NVDATA init OK", 1);
  len = 4;
  if(nvdata.get("freq",(uint8_t *)&freq,&len)<0)
  {
    nvdata.set("freq",(uint8_t *)&freq,4);
    nvdata.set("bw",(uint8_t *)&bw,4);
    nvdata.set("sf",(uint8_t *)&sf,1);
    nvdata.set("cr",(uint8_t *)&cr,1);
    nvdata.set("syncword",(uint8_t *)&syncWord,1);
    nvdata.set("power",(uint8_t *)&power,1);
    nvdata.set("pl",(uint8_t *)&pl,1);
    nvdata.save();
  }
  else
  {
    len = 4;
    nvdata.get("bw",(uint8_t *)&bw,&len);
    len = 1;
    nvdata.get("sf",(uint8_t *)&sf,&len);
    len = 1;
    nvdata.get("cr",(uint8_t *)&cr,&len);
    len = 1;
    nvdata.get("syncword",(uint8_t *)&syncWord,&len);
    len = 1;
    nvdata.get("power",(uint8_t *)&power,&len);
    len = 1;
    nvdata.get("pl",(uint8_t *)&pl,&len);
  }

  Serial.printf("Radio Init\n");
  int state = RADIOLIB_ERR_CHIP_NOT_FOUND;
  if (probe_radio()) {
    state = radio.begin(freq, bw, sf, cr, syncWord, power, pl, 1.8, false);
  } else {
    Serial.println(F("no SX1262 detected on SPI/BUSY - skipping radio.begin"));
  }
  if (state == RADIOLIB_ERR_NONE) {
    radio_ok = true;
    Serial.println(F("success!"));
    display_status("Radio Init: OK", 2);

    #if defined(WIFI_LORA_32_V4) || defined(NIBBLE_ZERO)
    radio.setDio2AsRfSwitch(true);
    #endif

    // set the function that will be called when a new packet is received / sent
    radio.setPacketReceivedAction(radioEvent);
    radio.setPacketSentAction(radioEvent);

    Serial.print(F("[SX1262] Starting to listen ... "));
    state = radio.startReceive();
    if (state == RADIOLIB_ERR_NONE) {
      Serial.println(F("success!"));
      display_status("Listening...", 3);
    } else {
      radio_ok = false;
      Serial.print(F("startReceive failed, code "));
      Serial.println(state);
      display_status("Listen Fail", 3);
    }
  } else {
    radio_ok = false;
    Serial.print(F("radio init FAILED, code "));
    Serial.println(state);
    display_status("RADIO FAIL (alive)", 2);
  }
  // No more while(true): a missing/incompatible radio no longer wedges the board.
  // It keeps serving serial (diagnosable + reflashable); the heartbeat and a slow
  // red NeoPixel report the fault.
}
void led_on(int ms)
{
  digitalWrite(39,HIGH);
  led_off_time = millis() + ms;
}

void loop() {
  int i;
  serial_update();

  // Low-rate heartbeat so a live board is distinguishable from a wedged one.
  // ASCII only -> the host's 0x94/0xC3 frame parser ignores these bytes.
  static uint32_t hb = 0;
  if (millis() - hb > 5000) {
    hb = millis();
    Serial.printf("hb up=%lus rx=%d tx=%d radio=%s oled=%s\n",
                  (unsigned long)(millis()/1000), rx_count, tx_count,
                  radio_ok ? "OK" : "FAIL", oled_ok ? "OK" : "none");
  }
  
  // NeoPixel Status logic
  if(millis() < neopixel_off_time) {
    // Keep current color (Red/Green)
  } else {
    // Idle breathing: blue when healthy, RED when the radio is down (fault)
    uint8_t ramp = (uint8_t)((millis() / 16) & 0xFF);         // ~4s period
    uint8_t tri  = ramp < 128 ? ramp : (uint8_t)(255 - ramp); // 0..127..0
    uint8_t v    = 8 + (uint16_t)tri * 90 / 127;              // brightness 8..98
    if (radio_ok) neopixelWrite(NEOPIXEL_PIN, 0, 0, v);       // blue
    else          neopixelWrite(NEOPIXEL_PIN, v, 0, 0);       // red = radio fault
  }

  if(millis() >= led_off_time)
  {
    // Serial.printf("tick\n"); // Remove frequent ticks from serial
    led_off_time += 1000;
    digitalWrite(39,LOW);
  }
  if(transmitFlag)
  {
    int state;
    state = radio.startReceive();
    if (state == RADIOLIB_ERR_NONE) {
      // Serial.println(F("success!"));
    } else {
      Serial.print(F("startReceive(loop) failed, code "));
      Serial.println(state);
      radio_ok = false;   // degrade instead of hanging; heartbeat + LED report it
    }
    transmitFlag = false;
    int len = radio.getPacketLength(true);
    if(len > 0)
    {
      receivedFlag = true;
    }
    else if(txPending)     // TX just completed -> ACK for host flow control [#2]
    {
      txPending = false;
      picopb ack(ctrl_buf, sizeof(ctrl_buf));
      ack.write_varint(1, 3);
      serial_send(ctrl_buf, ack.get_length());
    }
  }
  // check if the flag is set
  if(receivedFlag) {
    // reset flag
    receivedFlag = false;

    // you can read received data as an Arduino String
    uint8_t readBuff[256];
    uint8_t pb_buff[512];
    uint8_t len = radio.getPacketLength(true);
    for(i=0;i<256;i++)
    {
      readBuff[i] = 0;
    }
    int state = radio.readData(readBuff,len);

    if (state == RADIOLIB_ERR_NONE) {
      neopixelWrite(NEOPIXEL_PIN, 0, 40, 0);   // RX = green
      neopixel_off_time = millis() + 200;
      rx_count++;
      update_display_counters();
      led_on(200);
      picopb pb(pb_buff,512);
      pb.write_varint(1,1);
      pb.write_string(2,readBuff,len);
      float rssi = radio.getRSSI(true);
      pb.write_i32(3,(int)rssi);
      float snr = radio.getSNR();
      pb.write_i32(4,(int)(snr*4));        // SNR x4 (host divides) [#5 metadata]
      pb.write_i32(6,(uint32_t)millis());  // device rx timestamp (ms) [#5 metadata]
      serial_send(pb_buff,pb.get_length());

      // POC 3: Silent Alarm
      // Decode the received Data protobuf to check PortNum
      picopb rx_pb(readBuff, len);
      uint32_t portnum = 0;
      // The Data PB has portnum at field 1
      // picopb doesn't have a full decoder, but we can search for tag 1
      for(int k=0; k<len; k++) {
        if(readBuff[k] == (1 << 3 | 0)) { // Tag 1, Type Varint
          portnum = readBuff[k+1]; // Simplified varint read
          break;
        }
      }
      if(portnum == 77) {
        neopixelWrite(NEOPIXEL_PIN, 30, 0, 30);  // silent alarm = purple
        neopixel_off_time = millis() + 1000;
        display_status("SILENT ALARM!", 3);
      }

    } else if (state == RADIOLIB_ERR_CRC_MISMATCH) {
      // packet was received, but is malformed
      Serial.println(F("CRC error!"));

    } else {
      // some other error occurred
      Serial.print(F("failed, code "));
      Serial.println(state);

    }
  }
}

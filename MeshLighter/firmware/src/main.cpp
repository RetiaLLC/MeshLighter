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
      pb.write_i32(3,rssi);
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

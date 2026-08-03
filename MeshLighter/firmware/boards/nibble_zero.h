#ifndef __NIBBLE_ZERO__
#define __NIBBLE_ZERO__

#include <U8g2lib.h>
#include <Wire.h>
// NeoPixel driven by the ESP32 core's built-in neopixelWrite() (RMT) — no FastLED.
// FastLED's IDF5 I2S-audio module fails to compile on current toolchains and we
// only need one status LED, so the heavy dependency is gone.

// SPI pins
#define SS        GPIO_NUM_10
#define MOSI      GPIO_NUM_11
#define MISO      GPIO_NUM_13
#define SCK       GPIO_NUM_12

// Radio pins
#define DIO1      GPIO_NUM_4
#define RST_LoRa  GPIO_NUM_6
#define BUSY_LoRa GPIO_NUM_5

// I2C pins for OLED
#define OLED_SDA  8
#define OLED_SCL  7

// NeoPixel pin
#define NEOPIXEL_PIN 21
#define NUM_LEDS 1

SPIClass hspi(FSPI); // Use FSPI for ESP32-S3
// The radio object is constructed at runtime after board detection (see main.cpp),
// so one image runs on the Nibble (SX1262) and the DEF CON badge (SX1276/RFM95).

U8G2_SSD1306_128X64_NONAME_F_HW_I2C u8g2(U8G2_R0, /* reset=*/ U8X8_PIN_NONE, /* clock=*/ OLED_SCL, /* data=*/ OLED_SDA);

bool oled_ok = false;   // set true only if an SSD1306 actually answers on I2C

static bool probe_i2c(uint8_t addr)
{
  Wire.beginTransmission(addr);
  return Wire.endTransmission() == 0;
}

void board_init()
{
  // SPI + radio are set up in detect_radio() (main.cpp); NeoPixel after detection.
  Wire.begin(OLED_SDA, OLED_SCL);

  // Probe for the SSD1306 before touching U8g2. On a board without this OLED
  // (e.g. a DEF CON badge / bare S3 Zero) U8g2's HW-I2C driver otherwise spews
  // "i2c_master_transmit failed" every frame, drowning the framed serial
  // protocol and corrupting host RX. Skip all display calls if it isn't there.
  oled_ok = probe_i2c(0x3C) || probe_i2c(0x3D);
  if (oled_ok) {
    u8g2.begin();
    u8g2.clearBuffer();
    u8g2.setFont(u8g2_font_ncenB08_tr);
    u8g2.drawStr(0,10,"lora-lite init...");
    u8g2.sendBuffer();
  }
}

#endif

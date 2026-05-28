#ifndef __NIBBLE_ZERO__
#define __NIBBLE_ZERO__

#include <U8g2lib.h>
#include <Wire.h>
#include <FastLED.h>

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

CRGB leds[NUM_LEDS];

SPIClass hspi(FSPI); // Use FSPI for ESP32-S3
SX1262 radio = new Module(SS, DIO1, RST_LoRa, BUSY_LoRa, hspi);

U8G2_SSD1306_128X64_NONAME_F_HW_I2C u8g2(U8G2_R0, /* reset=*/ U8X8_PIN_NONE, /* clock=*/ OLED_SCL, /* data=*/ OLED_SDA);

void board_init()
{
  hspi.begin(SCK, MISO, MOSI, SS);
  Wire.begin(OLED_SDA, OLED_SCL);
  u8g2.begin();
  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_ncenB08_tr);
  u8g2.drawStr(0,10,"lora-lite init...");
  u8g2.sendBuffer();

  FastLED.addLeds<WS2812B, NEOPIXEL_PIN, GRB>(leds, NUM_LEDS);
  FastLED.setBrightness(50);
  leds[0] = CRGB::Blue;
  FastLED.show();
}

#endif

#ifndef __HELTEC_V3__
#define __HELTEC_V3__

// SPI pins
#define SS        GPIO_NUM_10
#define MOSI      GPIO_NUM_11
#define MISO      GPIO_NUM_12
#define SCK       GPIO_NUM_13
// Radio pins
#define DIO1      GPIO_NUM_4
#define RST_LoRa  GPIO_NUM_6
#define BUSY_LoRa GPIO_NUM_5

SPIClass* hspi = new SPIClass(HSPI);
SX1262 radio = new Module(SS, DIO1, RST_LoRa, BUSY_LoRa, *hspi);

void board_init()
{
  hspi->begin(SCK, MISO, MOSI, SS);
}

#endif

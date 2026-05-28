#ifndef __SERIAL_INTERFACE_H__
#define __SERIAL_INTERFACE_H__

#include <Arduino.h>

void serial_init();

void serial_update();

void serial_send(uint8_t *buffer, int len);

#endif

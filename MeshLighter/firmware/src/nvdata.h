#ifndef __NVData_H__
#define __NVData_H__

#include <Arduino.h>

struct NVEntry_s
{
   uint8_t klen;
   uint8_t *key;
   uint8_t vlen;
   uint8_t *val;
};

typedef struct NVEntry_s NVEntry;

class NVData
{
   public:
      NVData();
      int init(char *partname = "spiffs");
      int set(char *key,uint8_t *value, int len);
      int get(char *key,uint8_t *value, int *len);
      int save();

   private:
      //API wrappers
      int block_read(int index);
      int block_write(int index);
      int block_clear(int index);
      
      //helpers
      int block_init(int index);
      int block_load(int index);
      int block_save(int index);

      //state data
      const esp_partition_t *part;
      unsigned int numblocks;
      int current_read_block;
      int active_block;
      int writecounter;

      //working data
      uint8_t *tempdata;
      uint8_t tempkey[64];
      NVEntry *entries;
      int num_entries;


};

extern NVData nvdata;
#endif
